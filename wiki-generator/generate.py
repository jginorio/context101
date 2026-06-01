"""
Context101 Wiki Generator.

Flow:
  1. List .md files from s3://DOCS_BUCKET/ excluding WIKI_PREFIX.
  2. Build a corpus summary (S3 key + preview + last-modified of each doc).
  3. Call the configured model with the structure prompt → XML plan.
  4. For each page in the plan:
       a. Read the full content of each relevant_file from S3.
       b. Generate N candidate drafts, then run a judge call that merges
          them into one page and resolves intra-page source conflicts by
          preferring the newer source (Level 1). Single-source pages skip
          candidates+judge and take a single call.
       c. Write s3://DOCS_BUCKET/WIKI_PREFIX/<slug>.md.
       d. Write a .metadata.json sidecar tagging the page source=wiki so
          search_knowledge's source=wiki filter picks it up. Raw docs have
          no sidecar, so they're excluded from canonical retrieval.
  5. Reconcile pages that share sources (Level 3 cross-page consistency).
  6. Write WIKI_PREFIX/_index.json (nav), WIKI_PREFIX/_meta.json (timestamp),
     WIKI_PREFIX/_drift.json (conflict/review queue), and a per-run cost
     record under WIKI_PREFIX/_runs/<run_id>.json.

Conflict resolution always prefers the newer source by recency, using the
source_modified_at stamped onto each doc's sidecar by the connectors.

Runs to completion and exits — designed for Fargate tasks or local invocation.
"""

import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from xml.etree import ElementTree as ET

import boto3
from botocore.config import Config

from prompts import (
    CODE_JUDGE_PROMPT,
    CODE_PAGE_PROMPT,
    CODE_STRUCTURE_PROMPT,
    CROSS_PAGE_PROMPT,
    JUDGE_PROMPT,
    PAGE_PROMPT,
    STRUCTURE_PROMPT,
    VARIANT_DIRECTIVE,
)

# ── Config ────────────────────────────────────────────────────────────

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
AWS_PROFILE = os.environ.get("AWS_PROFILE")
DOCS_BUCKET = os.environ["DOCS_BUCKET"]
WIKI_PREFIX = os.environ.get("WIKI_PREFIX", "wiki/")
# WIKI_MODE: "main" (default) generates the cross-source team wiki at
# wiki/<slug>.md. "code" generates a per-repo deepwiki-style wiki under
# wiki/code/<repo-slug>/<slug>.md, with code-specialized prompts and
# corpus scoped to a single repo.
WIKI_MODE = os.environ.get("WIKI_MODE", "main")
# CORPUS_PREFIX scopes the input corpus to a single S3 prefix. Empty =
# whole bucket (main mode). Set to e.g. "sources/github/<repo-slug>/"
# for code mode.
CORPUS_PREFIX = os.environ.get("CORPUS_PREFIX", "")
# REPO_FULL_NAME ("owner/repo") is interpolated into code-mode prompts so
# the model knows which repo it's documenting. Ignored in main mode.
REPO_FULL_NAME = os.environ.get("REPO_FULL_NAME", "")
# Model is fully configurable; deployments set MODEL_ID via env (CDK / per-brain
# start-wiki-gen override). The literal fallback is only used for unconfigured
# local runs and is deliberately model-neutral (no hardcoded "Opus").
MODEL_ID = (
    os.environ.get("MODEL_ID")
    or os.environ.get("DEFAULT_MODEL_ID")
    or "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
)
# DRAFT_MODEL_ID is the model used for candidate *drafts* only. It defaults to
# MODEL_ID, so every call uses the strong model today. Pointing it at a cheaper
# model (same MODEL_PROVIDER) is a future cost lever — see the candidate path.
# DEFERRED: cheaper draft model. Seam is wired but the default keeps drafts on
# the strong model; flip DRAFT_MODEL_ID once a cheaper same-provider model is
# vetted for draft quality.
DRAFT_MODEL_ID = os.environ.get("DRAFT_MODEL_ID") or MODEL_ID
# Wiki model provider. "bedrock" (default) uses the keyless Bedrock path via
# the task role. Bring-your-own providers ("anthropic", "openai", "grok",
# "gemini") are routed through LiteLLM with an API key fetched from
# LLM_KEY_SECRET_ARN (a Secrets Manager ARN injected by start-wiki-gen).
MODEL_PROVIDER = os.environ.get("MODEL_PROVIDER", "bedrock").lower()
LLM_KEY_SECRET_ARN = os.environ.get("LLM_KEY_SECRET_ARN")
MIN_PAGES = int(os.environ.get("MIN_PAGES", "4"))
MAX_PAGES = int(os.environ.get("MAX_PAGES", "8"))
CORPUS_PREVIEW_CHARS = int(os.environ.get("CORPUS_PREVIEW_CHARS", "600"))
MAX_TOKENS = int(os.environ.get("MAX_TOKENS", "8192"))
# WIKI_FORCE=1 bypasses the no-change corpus-hash guard. Set by the
# /api/wiki/refresh POST path (manual button) but NOT by the EventBridge
# scheduled tick — so the 10h schedule becomes a near-no-op when nothing
# in the corpus has changed since the last successful regen.
WIKI_FORCE = os.environ.get("WIKI_FORCE", "").lower() in ("1", "true", "yes")

# ── Map-reduce + judge (Phase 3) ──────────────────────────────────────
# WIKI_CANDIDATES: how many candidate drafts to produce per multi-source page
# before the judge merges them. Default 2; capped at 3. =1 reproduces the old
# single-pass behaviour and cost (no judge). Single-source pages always take a
# single call regardless of this value.
WIKI_CANDIDATES = max(1, min(3, int(os.environ.get("WIKI_CANDIDATES", "2"))))
# Temperature spread for candidates after candidate 0 (the deterministic
# baseline). Only used when WIKI_CANDIDATES > 1.
CANDIDATE_TEMPERATURE = float(os.environ.get("CANDIDATE_TEMPERATURE", "0.6"))

# ── Drift write-back (Phase 4) ────────────────────────────────────────
# Off by default. When on, dry-run still defaults true so the first live
# enablement only logs intended actions. See drift_actions.dispatch.
WIKI_DRIFT_WRITEBACK = os.environ.get("WIKI_DRIFT_WRITEBACK", "").lower() in (
    "1",
    "true",
    "yes",
)
WIKI_DRIFT_DRYRUN = os.environ.get("WIKI_DRIFT_DRYRUN", "1").lower() in (
    "1",
    "true",
    "yes",
)

# ── Cost tracking (Phase 5) ───────────────────────────────────────────
# Bedrock/LiteLLM only return token counts, never dollars. We record exact
# tokens and derive an *estimated* dollar figure from a per-model rate table
# (USD per 1M tokens). Override the configured model's rate via env; unknown
# models fall back to tokens-only (cost_usd=None). Update as published prices
# change — these are estimates, not billed actuals.
MODEL_PRICES: dict[str, dict[str, float]] = {
    # input / output USD per 1M tokens.
    "us.anthropic.claude-opus-4-7": {"input": 15.0, "output": 75.0},
    "us.anthropic.claude-sonnet-4-5-20250929-v1:0": {"input": 3.0, "output": 15.0},
    "us.anthropic.claude-3-5-sonnet-20241022-v2:0": {"input": 3.0, "output": 15.0},
    "us.anthropic.claude-3-5-haiku-20241022-v1:0": {"input": 0.8, "output": 4.0},
}


def _price_override(model_id: str) -> dict[str, float] | None:
    """Env override for the configured model's rate (USD per 1M tokens)."""
    inp = os.environ.get("MODEL_PRICE_INPUT_PER_1M")
    out = os.environ.get("MODEL_PRICE_OUTPUT_PER_1M")
    if model_id in (MODEL_ID, DRAFT_MODEL_ID) and inp and out:
        try:
            return {"input": float(inp), "output": float(out)}
        except ValueError:
            return None
    return None


if not WIKI_PREFIX.endswith("/"):
    WIKI_PREFIX += "/"
if CORPUS_PREFIX and not CORPUS_PREFIX.endswith("/"):
    CORPUS_PREFIX += "/"


# ── AWS clients ───────────────────────────────────────────────────────

_session = boto3.Session(region_name=AWS_REGION, profile_name=AWS_PROFILE)
_cfg = Config(retries={"max_attempts": 5, "mode": "adaptive"}, read_timeout=300)

s3 = _session.client("s3", config=_cfg)
bedrock = _session.client("bedrock-runtime", config=_cfg)
secrets_client = _session.client("secretsmanager", config=_cfg)


# ── Types ─────────────────────────────────────────────────────────────


@dataclass
class SourceDoc:
    key: str
    body: str
    # Freshness signal stamped by the connectors onto the .metadata.json
    # sidecar (the source's true last-edited time, not its sync time). None
    # when the sidecar is missing or pre-dates the connector change — callers
    # degrade gracefully (conflicts get flagged instead of auto-resolved).
    source_modified_at: str | None = None
    source_author: str | None = None
    source_url: str | None = None
    # S3 ETag at list time — part of each page's provenance record.
    etag: str | None = None


@dataclass
class PageSpec:
    id: str
    title: str
    description: str
    importance: str
    relevant_files: list[str]
    related_pages: list[str]
    slug: str  # derived; filename under WIKI_PREFIX


@dataclass
class DriftFinding:
    """A conflict the judge could not silently resolve, queued for review.

    Emitted both by the per-page judge (Level 1: a page's own sources
    disagree) and the cross-page reduce step (Level 3: two pages drift apart).
    `newer_key` is the source the recency rule preferred (may be empty when
    timestamps were missing/equal — those are flagged, not auto-resolved).
    """

    page_slug: str
    page_title: str
    level: str  # "within_page" | "cross_page"
    conflicting_keys: list[str]
    source_urls: list[str]
    newer_key: str
    description: str
    suggested_action: str
    finding_id: str = ""

    def __post_init__(self) -> None:
        if not self.finding_id:
            basis = "|".join(
                [self.page_slug, *sorted(self.conflicting_keys), self.description]
            )
            self.finding_id = hashlib.sha256(basis.encode("utf-8")).hexdigest()[:16]

    def to_dict(self) -> dict:
        return {
            "finding_id": self.finding_id,
            "page_slug": self.page_slug,
            "page_title": self.page_title,
            "level": self.level,
            "conflicting_keys": self.conflicting_keys,
            "source_urls": self.source_urls,
            "newer_key": self.newer_key,
            "description": self.description,
            "suggested_action": self.suggested_action,
        }


# ── Corpus loading ────────────────────────────────────────────────────


def _is_excluded(key: str) -> bool:
    """Decide whether to skip a key from the corpus."""
    # Always skip sidecars and "directory" keys.
    if key.endswith(".metadata.json") or key.endswith("/"):
        return True
    if not key.endswith(".md"):
        return True

    # Code-mode: include only the configured corpus prefix.
    if WIKI_MODE == "code":
        if not key.startswith(CORPUS_PREFIX or "sources/github/"):
            return True
        # Don't ingest our own output if a previous run wrote there.
        if key.startswith(WIKI_PREFIX):
            return True
        return False

    # Main mode: skip top-level wiki/<slug>.md (avoid feeding our own
    # output back in), but keep wiki/code/<repo>/<slug>.md so the team
    # wiki can cite pre-synthesized code-wiki pages.
    if key.startswith("wiki/code/"):
        return False
    if key.startswith("wiki/"):
        return True
    return False


def list_corpus_entries() -> list[tuple[str, str]]:
    """List (key, etag) pairs for every corpus doc, mode-aware.

    Cheap: just paginates ListObjectsV2 (no GetObject). Used both as the
    input to the no-change guard and as the work list for the body-loading
    pass below. Sorted by key for deterministic hashing.
    """
    entries: list[tuple[str, str]] = []
    paginator = s3.get_paginator("list_objects_v2")
    list_prefix = CORPUS_PREFIX if WIKI_MODE == "code" else ""
    paginate_kwargs: dict = {"Bucket": DOCS_BUCKET}
    if list_prefix:
        paginate_kwargs["Prefix"] = list_prefix
    for page in paginator.paginate(**paginate_kwargs):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if _is_excluded(key):
                continue
            etag = (obj.get("ETag") or "").strip('"')
            entries.append((key, etag))
    entries.sort(key=lambda kv: kv[0])
    return entries


def compute_corpus_sha(entries: list[tuple[str, str]]) -> str:
    """SHA-256 over sorted (key, etag) pairs.

    ETags change iff content changes (multi-part uploaded ETags look like
    "<md5>-<n>" but are still deterministic from content), so this is a
    stable fingerprint of the corpus without downloading any bodies.
    Includes the WIKI_MODE so a main-mode corpus hash can never collide
    with a code-mode hash on the same key set.
    """
    h = hashlib.sha256()
    h.update(WIKI_MODE.encode("utf-8"))
    h.update(b"\0")
    for key, etag in entries:
        h.update(key.encode("utf-8"))
        h.update(b"\t")
        h.update(etag.encode("utf-8"))
        h.update(b"\n")
    return h.hexdigest()


def read_prior_meta() -> dict:
    """Read the existing wiki/_meta.json (or wiki/code/<repo>/_meta.json).

    Returns an empty dict on first run / missing object — caller treats
    a missing corpus_sha as "always regenerate".
    """
    key = f"{WIKI_PREFIX}_meta.json"
    try:
        obj = s3.get_object(Bucket=DOCS_BUCKET, Key=key)
    except s3.exceptions.NoSuchKey:
        return {}
    except Exception as e:
        print(f"  [warn] couldn't read prior {key}: {e}", file=sys.stderr)
        return {}
    try:
        return json.loads(obj["Body"].read().decode("utf-8"))
    except Exception as e:
        print(f"  [warn] prior {key} unparseable: {e}", file=sys.stderr)
        return {}


def _read_sidecar_freshness(key: str) -> dict:
    """Best-effort read of a source's <key>.metadata.json sidecar.

    Returns the connector-stamped freshness attrs (source_modified_at,
    source_author, source_url) or {} when the sidecar is missing/unparseable.
    Sidecars are written by the connector-sync-* lambdas (Phase 1); older
    syncs may lack the freshness fields, so every field is optional.
    """
    try:
        obj = s3.get_object(Bucket=DOCS_BUCKET, Key=f"{key}.metadata.json")
        attrs = json.loads(obj["Body"].read().decode("utf-8")).get(
            "metadataAttributes", {}
        )
    except Exception:
        return {}
    return {
        "source_modified_at": attrs.get("source_modified_at"),
        "source_author": attrs.get("source_author"),
        "source_url": attrs.get("source_url") or attrs.get("url"),
    }


def load_source_docs(entries: list[tuple[str, str]]) -> list[SourceDoc]:
    """Body-load pass — only run after the no-change guard decides to regen.

    Takes the (key, etag) entries from list_corpus_entries so each doc carries
    its ETag (for provenance) and reads the freshness sidecar (for recency).
    """
    docs: list[SourceDoc] = []
    for key, etag in entries:
        obj = s3.get_object(Bucket=DOCS_BUCKET, Key=key)
        body = obj["Body"].read().decode("utf-8", errors="replace")
        fresh = _read_sidecar_freshness(key)
        docs.append(
            SourceDoc(
                key=key,
                body=body,
                source_modified_at=fresh.get("source_modified_at"),
                source_author=fresh.get("source_author"),
                source_url=fresh.get("source_url"),
                etag=etag or None,
            )
        )
    return docs


def build_corpus_summary(docs: list[SourceDoc]) -> str:
    parts = []
    for d in docs:
        preview = d.body.strip()[:CORPUS_PREVIEW_CHARS]
        modified = f' modified="{d.source_modified_at}"' if d.source_modified_at else ""
        parts.append(f'<doc path="{d.key}"{modified}>\n{preview}\n</doc>')
    return "\n\n".join(parts)


# ── Bedrock call ──────────────────────────────────────────────────────


_llm_key_cache: str | None = None

# Map our provider names to LiteLLM's "<provider>/<model>" prefix.
_LITELLM_PREFIX = {
    "anthropic": "anthropic",
    "openai": "openai",
    "grok": "xai",
    "gemini": "gemini",
}


def _llm_api_key() -> str:
    """Fetch (and cache) the bring-your-own API key from Secrets Manager."""
    global _llm_key_cache
    if _llm_key_cache is not None:
        return _llm_key_cache
    if not LLM_KEY_SECRET_ARN:
        raise RuntimeError(
            f"Provider '{MODEL_PROVIDER}' requires an API key but "
            "LLM_KEY_SECRET_ARN is not set."
        )
    resp = secrets_client.get_secret_value(SecretId=LLM_KEY_SECRET_ARN)
    key = (resp.get("SecretString") or "").strip()
    if not key:
        raise RuntimeError("LLM API key secret is empty.")
    _llm_key_cache = key
    return key


# Per-run cost ledger (Phase 5). Each LLM call appends one event tagged with
# its pipeline stage so we can attribute spend (structure vs drafts vs judge vs
# cross-page) after the run. Token counts come straight from the provider; the
# dollar figure is derived later from MODEL_PRICES.
COST_EVENTS: list[dict] = []


def _record_usage(stage: str, model_id: str, input_tokens: int, output_tokens: int) -> None:
    COST_EVENTS.append(
        {
            "stage": stage,
            "model_id": model_id,
            "input_tokens": int(input_tokens or 0),
            "output_tokens": int(output_tokens or 0),
        }
    )


def _invoke_bedrock(
    user_text: str, stage: str, model_id: str, temperature: float | None
) -> str:
    """Single-turn Converse call to a Bedrock model. Returns assistant text."""
    inference_config: dict = {"maxTokens": MAX_TOKENS}
    if temperature is not None:
        inference_config["temperature"] = temperature
    resp = bedrock.converse(
        modelId=model_id,
        messages=[{"role": "user", "content": [{"text": user_text}]}],
        inferenceConfig=inference_config,
    )
    usage = resp.get("usage", {})
    _record_usage(
        stage, model_id, usage.get("inputTokens", 0), usage.get("outputTokens", 0)
    )
    content = resp["output"]["message"]["content"]
    return "".join(block.get("text", "") for block in content).strip()


def _invoke_litellm(
    user_text: str, stage: str, model_id: str, temperature: float | None
) -> str:
    """Single-turn completion via LiteLLM for bring-your-own providers."""
    import litellm

    prefix = _LITELLM_PREFIX.get(MODEL_PROVIDER)
    if not prefix:
        raise RuntimeError(f"Unsupported wiki model provider: {MODEL_PROVIDER}")
    if not model_id:
        raise RuntimeError(f"MODEL_ID is required for provider '{MODEL_PROVIDER}'.")

    kwargs: dict = {
        "model": f"{prefix}/{model_id}",
        "messages": [{"role": "user", "content": user_text}],
        "max_tokens": MAX_TOKENS,
        "api_key": _llm_api_key(),
    }
    if temperature is not None:
        kwargs["temperature"] = temperature
    resp = litellm.completion(**kwargs)
    usage = getattr(resp, "usage", None)
    _record_usage(
        stage,
        model_id,
        getattr(usage, "prompt_tokens", 0) if usage else 0,
        getattr(usage, "completion_tokens", 0) if usage else 0,
    )
    return (resp.choices[0].message.content or "").strip()


def invoke_llm(
    user_text: str,
    *,
    stage: str = "other",
    model_id: str | None = None,
    temperature: float | None = None,
) -> str:
    """Single-turn LLM call routed to the configured provider.

    `stage` tags the call for per-stage cost attribution (Phase 5). `model_id`
    defaults to MODEL_ID; the candidate-draft path passes DRAFT_MODEL_ID.
    `temperature` is forwarded to the provider when set (candidate spread).
    """
    model = model_id or MODEL_ID
    if MODEL_PROVIDER == "bedrock":
        return _invoke_bedrock(user_text, stage, model, temperature)
    return _invoke_litellm(user_text, stage, model, temperature)


# ── Structure parsing ────────────────────────────────────────────────

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(title: str) -> str:
    slug = _SLUG_RE.sub("-", title.lower()).strip("-")
    return slug or "page"


_ENTITY_RE = re.compile(r"&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)")


def escape_stray_ampersands(xml: str) -> str:
    """Escape bare '&' that aren't already part of a valid XML entity.

    Opus occasionally emits titles like "Findit & Amplia" which would
    otherwise make ElementTree fail with 'not well-formed (invalid token)'.
    """
    return _ENTITY_RE.sub("&amp;", xml)


def extract_xml(text: str) -> str:
    """Pull the <wiki_structure>...</wiki_structure> block out of the model output.

    Defensive against: leading prose, markdown code fences, stray control chars,
    unescaped ampersands in text content.
    """
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:xml)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    match = re.search(
        r"<wiki_structure>.*?</wiki_structure>", cleaned, re.DOTALL
    )
    if not match:
        raise ValueError(
            f"No <wiki_structure> block in model output. First 400 chars: {text[:400]!r}"
        )
    # Strip control chars that break ET.
    without_controls = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", match.group(0))
    return escape_stray_ampersands(without_controls)


def parse_structure(xml_text: str, valid_keys: set[str]) -> tuple[str, str, list[PageSpec]]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        # Dump the XML for post-mortem so we don't have to re-run Opus.
        dump_path = os.environ.get("XML_DUMP_PATH", "/tmp/wiki-structure-broken.xml")
        try:
            with open(dump_path, "w", encoding="utf-8") as f:
                f.write(xml_text)
            print(f"  [error] dumped failing XML to {dump_path}", file=sys.stderr)
        except OSError:
            pass
        raise
    title = (root.findtext("title") or "Wiki").strip()
    description = (root.findtext("description") or "").strip()

    pages_container = root.find("pages")
    if pages_container is None:
        raise ValueError("Structure XML missing <pages>")

    used_slugs: set[str] = set()
    specs: list[PageSpec] = []
    for page_el in pages_container.findall("page"):
        page_id = page_el.get("id") or f"page-{len(specs) + 1}"
        p_title = (page_el.findtext("title") or "Untitled").strip()
        p_desc = (page_el.findtext("description") or "").strip()
        p_importance = (page_el.findtext("importance") or "medium").strip().lower()

        rel_files_el = page_el.find("relevant_files")
        rel_files: list[str] = []
        if rel_files_el is not None:
            for fp in rel_files_el.findall("file_path"):
                key = (fp.text or "").strip()
                if not key:
                    continue
                if key not in valid_keys:
                    print(
                        f"  [warn] page {page_id} references unknown key {key!r} — dropping",
                        file=sys.stderr,
                    )
                    continue
                rel_files.append(key)

        related_el = page_el.find("related_pages")
        related = [
            (r.text or "").strip()
            for r in (related_el.findall("related") if related_el is not None else [])
            if (r.text or "").strip()
        ]

        slug = slugify(p_title)
        base = slug
        n = 2
        while slug in used_slugs:
            slug = f"{base}-{n}"
            n += 1
        used_slugs.add(slug)

        specs.append(
            PageSpec(
                id=page_id,
                title=p_title,
                description=p_desc,
                importance=p_importance,
                relevant_files=rel_files,
                related_pages=related,
                slug=slug,
            )
        )

    return title, description, specs


# ── Per-page generation (map) + judge (reduce, Level 1) ───────────────


def _source_blocks(spec: PageSpec, docs_by_key: dict[str, SourceDoc]) -> str:
    blocks = []
    for key in spec.relevant_files:
        doc = docs_by_key[key]
        blocks.append(f'<file path="{doc.key}">\n{doc.body}\n</file>')
    return "\n\n".join(blocks)


def _freshness_table(spec: PageSpec, docs_by_key: dict[str, SourceDoc]) -> str:
    """Per-source recency table fed to the judge so it can prefer the newer
    source when this page's own sources disagree (Level 1)."""
    rows = []
    for key in spec.relevant_files:
        doc = docs_by_key.get(key)
        modified = (doc.source_modified_at if doc else None) or "unknown"
        rows.append(f'  <source key="{key}" modified="{modified}" />')
    return "<sources>\n" + "\n".join(rows) + "\n</sources>"


def _newer_key(keys: list[str], docs_by_key: dict[str, SourceDoc]) -> str:
    """The key with the latest source_modified_at, or "" if undecidable
    (fewer than two dated sources). Recency is computed in Python from the
    connector stamps — we never trust the model's date arithmetic."""
    dated = [
        (k, docs_by_key[k].source_modified_at)
        for k in keys
        if docs_by_key.get(k) and docs_by_key[k].source_modified_at
    ]
    if len(dated) < 2:
        return ""
    dated.sort(key=lambda kv: kv[1], reverse=True)
    return dated[0][0]


def generate_page_candidates(
    spec: PageSpec, docs_by_key: dict[str, SourceDoc]
) -> list[str]:
    """Produce candidate drafts for a page (the map step).

    Single-source pages (and WIKI_CANDIDATES=1) take a single call on the
    strong MODEL_ID and skip the judge — there are no intra-page conflicts to
    reconcile. Multi-source pages produce WIKI_CANDIDATES drafts on
    DRAFT_MODEL_ID (candidate 0 is the deterministic baseline; later candidates
    add a variant directive + temperature spread)."""
    if not spec.relevant_files:
        raise ValueError(f"Page {spec.id} ({spec.title}) has no relevant_files")

    source_content = _source_blocks(spec, docs_by_key)
    template = CODE_PAGE_PROMPT if WIKI_MODE == "code" else PAGE_PROMPT
    base_prompt = template.format(
        page_title=spec.title,
        page_description=spec.description,
        source_content=source_content,
        repo_full_name=REPO_FULL_NAME or "this repository",
    )

    n = WIKI_CANDIDATES if len(spec.relevant_files) >= 2 else 1
    single = n == 1
    candidates: list[str] = []
    for i in range(n):
        variant = i > 0
        prompt = base_prompt + (f"\n\n{VARIANT_DIRECTIVE}" if variant else "")
        candidates.append(
            invoke_llm(
                prompt,
                stage="page" if single else "draft",
                model_id=MODEL_ID if single else DRAFT_MODEL_ID,
                temperature=CANDIDATE_TEMPERATURE if variant else None,
            )
        )
    return candidates


def _strip_fences(text: str) -> str:
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:markdown|md)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()


def _split_drift(raw: str) -> tuple[str, str]:
    """Split judge output into (page_markdown, drift_findings_xml).

    The judge emits the merged page first, then an optional fenced
    <drift_findings> block. Defensive: missing block → no findings."""
    match = re.search(r"<drift_findings>.*?</drift_findings>", raw, re.DOTALL)
    if not match:
        return _strip_fences(raw), ""
    return _strip_fences(raw[: match.start()]), match.group(0)


def parse_drift_findings(
    drift_xml: str,
    spec: PageSpec,
    docs_by_key: dict[str, SourceDoc],
    level: str,
) -> list[DriftFinding]:
    """Parse the judge's <drift_findings> block into DriftFinding records.

    The model names the conflicting source keys + describes the conflict; we
    compute newer_key ourselves from the connector timestamps (authoritative).
    Parses defensively, mirroring extract_xml — a malformed block yields no
    findings rather than failing the whole run."""
    if not drift_xml:
        return []
    without_controls = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", drift_xml)
    try:
        root = ET.fromstring(escape_stray_ampersands(without_controls))
    except ET.ParseError as e:
        print(f"  [warn] unparseable <drift_findings> on {spec.slug}: {e}", file=sys.stderr)
        return []

    findings: list[DriftFinding] = []
    for f_el in root.findall("finding"):
        keys_el = f_el.find("conflicting_keys")
        keys = [
            (k.text or "").strip()
            for k in (keys_el.findall("key") if keys_el is not None else [])
            if (k.text or "").strip()
        ]
        # Drop keys that aren't actually sources of this page (model noise).
        keys = [k for k in keys if k in docs_by_key]
        if not keys:
            continue
        description = (f_el.findtext("description") or "").strip()
        suggested = (f_el.findtext("suggested_action") or "").strip()
        urls = [docs_by_key[k].source_url for k in keys if docs_by_key[k].source_url]
        findings.append(
            DriftFinding(
                page_slug=spec.slug,
                page_title=spec.title,
                level=level,
                conflicting_keys=keys,
                source_urls=[u for u in urls if u],
                newer_key=_newer_key(keys, docs_by_key),
                description=description,
                suggested_action=suggested,
            )
        )
    return findings


def judge_page(
    spec: PageSpec, candidates: list[str], docs_by_key: dict[str, SourceDoc]
) -> tuple[str, list[DriftFinding]]:
    """Merge candidate drafts into one page and resolve intra-page source
    conflicts by preferring the newer source (Level 1). Returns the final page
    body and any unresolved conflicts as DriftFindings."""
    cand_blocks = "\n\n".join(
        f'<candidate n="{i + 1}">\n{c}\n</candidate>' for i, c in enumerate(candidates)
    )
    template = CODE_JUDGE_PROMPT if WIKI_MODE == "code" else JUDGE_PROMPT
    prompt = template.format(
        page_title=spec.title,
        freshness_table=_freshness_table(spec, docs_by_key),
        candidates=cand_blocks,
    )
    raw = invoke_llm(prompt, stage="judge", model_id=MODEL_ID)
    body, drift_xml = _split_drift(raw)
    findings = parse_drift_findings(drift_xml, spec, docs_by_key, "within_page")
    return body, findings


def render_page(
    spec: PageSpec, docs_by_key: dict[str, SourceDoc]
) -> tuple[str, list[DriftFinding]]:
    """Full per-page pipeline: candidates → judge. Single-candidate pages skip
    the judge and return the lone draft with no findings."""
    candidates = generate_page_candidates(spec, docs_by_key)
    if len(candidates) < 2:
        return _strip_fences(candidates[0]), []
    return judge_page(spec, candidates, docs_by_key)


# ── Cross-page consistency (reduce, Level 3) ──────────────────────────


def overlapping_pairs(specs: list[PageSpec]) -> list[tuple[PageSpec, PageSpec]]:
    """Pairs of pages that can legitimately contradict each other: they share
    at least one source key, or appear in each other's related_pages. Built
    from an in-memory source→pages map so we never compare all pairs (pages
    that share no sources are never compared)."""
    by_id = {s.id: s for s in specs}
    by_source: dict[str, list[str]] = {}
    for s in specs:
        for k in s.relevant_files:
            by_source.setdefault(k, []).append(s.id)

    pair_ids: set[tuple[str, str]] = set()
    for ids in by_source.values():
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                pair_ids.add(tuple(sorted((ids[i], ids[j]))))
    for s in specs:
        for rid in s.related_pages:
            if rid in by_id and rid != s.id:
                pair_ids.add(tuple(sorted((s.id, rid))))

    return [(by_id[a], by_id[b]) for a, b in sorted(pair_ids)]


def judge_cross_page(
    a: PageSpec,
    b: PageSpec,
    body_a: str,
    body_b: str,
    docs_by_key: dict[str, SourceDoc],
) -> tuple[dict[str, str], list[DriftFinding]]:
    """Check two related pages for contradictions and reconcile them toward the
    newer shared source. Returns {page_id: reconciled_body} for any page the
    judge rewrote, plus DriftFindings for contradictions it could not resolve
    (e.g. equal/missing timestamps)."""
    shared = sorted(set(a.relevant_files) & set(b.relevant_files))
    template = CROSS_PAGE_PROMPT
    prompt = template.format(
        page_a_id=a.id,
        page_a_title=a.title,
        page_b_id=b.id,
        page_b_title=b.title,
        freshness_table=_freshness_table_for_keys(shared, docs_by_key),
        page_a_body=body_a,
        page_b_body=body_b,
    )
    raw = invoke_llm(prompt, stage="cross_page", model_id=MODEL_ID)

    reconciled: dict[str, str] = {}
    for page_el in re.finditer(
        r'<reconciled id="([^"]+)">(.*?)</reconciled>', raw, re.DOTALL
    ):
        pid, body = page_el.group(1).strip(), _strip_fences(page_el.group(2))
        if pid in (a.id, b.id) and body:
            reconciled[pid] = body

    # Findings: reuse the per-page parser, attributing to page A's slug. Limit
    # conflicting keys to the shared sources so newer_key is meaningful.
    _, drift_xml = _split_drift(raw)
    findings = parse_drift_findings(drift_xml, a, docs_by_key, "cross_page")
    return reconciled, findings


def _freshness_table_for_keys(
    keys: list[str], docs_by_key: dict[str, SourceDoc]
) -> str:
    rows = []
    for key in keys:
        doc = docs_by_key.get(key)
        modified = (doc.source_modified_at if doc else None) or "unknown"
        rows.append(f'  <source key="{key}" modified="{modified}" />')
    return "<sources>\n" + "\n".join(rows) + "\n</sources>"


# ── S3 writes ─────────────────────────────────────────────────────────


def put_object(key: str, body: str, content_type: str) -> None:
    s3.put_object(
        Bucket=DOCS_BUCKET,
        Key=key,
        Body=body.encode("utf-8"),
        ContentType=content_type,
    )


# ── Cost aggregation (Phase 5) ────────────────────────────────────────


def _rate_for(model_id: str) -> dict[str, float] | None:
    """USD-per-1M-token rate for a model: env override first, then the table.
    None when unknown (caller reports tokens only, cost_usd=None)."""
    return _price_override(model_id) or MODEL_PRICES.get(model_id)


def _cost_usd(model_id: str, input_tokens: int, output_tokens: int) -> float | None:
    rate = _rate_for(model_id)
    if rate is None:
        return None
    return round(
        input_tokens / 1_000_000 * rate["input"]
        + output_tokens / 1_000_000 * rate["output"],
        6,
    )


def aggregate_costs() -> dict:
    """Roll COST_EVENTS up into per-stage and total token/dollar figures.

    Dollars are estimates derived from MODEL_PRICES; if any event used a model
    with no known rate, total_cost_usd is still reported but pricing_source is
    flagged "partial" so the UI can caveat it. Tokens are always exact."""
    stages: dict[str, dict] = {}
    any_priced = False
    any_unpriced = False
    used_override = False
    for ev in COST_EVENTS:
        st = stages.setdefault(
            ev["stage"],
            {"calls": 0, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0},
        )
        st["calls"] += 1
        st["input_tokens"] += ev["input_tokens"]
        st["output_tokens"] += ev["output_tokens"]
        cost = _cost_usd(ev["model_id"], ev["input_tokens"], ev["output_tokens"])
        if cost is None:
            any_unpriced = True
        else:
            any_priced = True
            st["cost_usd"] += cost
            if _price_override(ev["model_id"]):
                used_override = True

    total_input = sum(s["input_tokens"] for s in stages.values())
    total_output = sum(s["output_tokens"] for s in stages.values())
    total_cost = round(sum(s["cost_usd"] for s in stages.values()), 6)
    for s in stages.values():
        s["cost_usd"] = round(s["cost_usd"], 6) if any_priced else None

    if not any_priced:
        pricing_source = "unknown"
    elif any_unpriced:
        pricing_source = "partial"
    elif used_override:
        pricing_source = "env"
    else:
        pricing_source = "table"

    return {
        "stages": stages,
        "total_input_tokens": total_input,
        "total_output_tokens": total_output,
        "total_cost_usd": total_cost if any_priced else None,
        "pricing_source": pricing_source,
    }


def _safe_run_id(started_at: str) -> str:
    """Filesystem/S3-safe run id derived from the ISO start timestamp."""
    return re.sub(r"[^0-9A-Za-z]+", "-", started_at).strip("-")


# ── Provenance (Phase 2.5, write-only) ────────────────────────────────


def build_provenance(
    specs: list[PageSpec], docs_by_key: dict[str, SourceDoc], started_at: str
) -> dict:
    """Per-page record of what each page was derived from (key + modified_at +
    etag). Written for transparency/drift and as the foundation a future
    per-page reuse/skip step would read. NOT consumed for skipping today.

    DEFERRED: per-page reuse/staleness skip. A future run would compare each
    page's sources here (modified_at + etag) against the prior provenance and
    skip unchanged ("REUSE") pages. Not built yet: the structure pass is an LLM
    call, so slugs/groupings drift between runs and a slug-keyed ledger rarely
    matches — it needs stable page identity (e.g. tags) first."""
    pages = {}
    for spec in specs:
        pages[spec.slug] = {
            "generated_at": started_at,
            "sources": [
                {
                    "key": k,
                    "modified_at": docs_by_key[k].source_modified_at
                    if k in docs_by_key
                    else None,
                    "etag": docs_by_key[k].etag if k in docs_by_key else None,
                }
                for k in spec.relevant_files
            ],
        }
    return pages


# Filterable metadata on S3 Vectors is capped at 2 KB/vector (summed across
# all attributes). `source`, `generated_at`, `page_slug` are tiny; only
# `source_files` can grow. Truncate it to leave headroom for the others.
_SOURCE_FILES_MAX_CHARS = 1500


def build_wiki_sidecar(
    slug: str, relevant_files: list[str], started_at: str
) -> dict:
    source_files = ",".join(relevant_files)
    if len(source_files) > _SOURCE_FILES_MAX_CHARS:
        source_files = source_files[: _SOURCE_FILES_MAX_CHARS - 3] + "..."
    # `source` drives search_knowledge's filter — only "wiki" is canonical
    # for top-level retrieval. "code-wiki" pages stay in the index but are
    # not returned by search_knowledge unless the agent reads them via
    # citations (the team wiki) or read_knowledge directly.
    source_tag = "code-wiki" if WIKI_MODE == "code" else "wiki"
    attrs: dict = {
        "source": source_tag,
        "generated_at": started_at,
        "page_slug": slug,
        "source_files": source_files,
    }
    if WIKI_MODE == "code" and REPO_FULL_NAME:
        attrs["repo"] = REPO_FULL_NAME
    return {"metadataAttributes": attrs}


def write_wiki_outputs(
    title: str,
    description: str,
    specs: list[PageSpec],
    page_bodies: dict[str, str],
    source_doc_count: int,
    started_at: str,
    corpus_sha: str,
    findings: list[DriftFinding],
    provenance: dict,
) -> None:
    # Pages + sidecars. Write the sidecar first so the next auto-ingest
    # run sees both files together and attaches metadata on first pass.
    for spec in specs:
        body = page_bodies[spec.id]
        md_key = f"{WIKI_PREFIX}{spec.slug}.md"
        sidecar = build_wiki_sidecar(spec.slug, spec.relevant_files, started_at)
        put_object(
            f"{md_key}.metadata.json",
            json.dumps(sidecar, indent=2),
            "application/json",
        )
        put_object(md_key, body, "text/markdown; charset=utf-8")

    # Nav index — maps page id → slug/title, preserves order + related links.
    # Each entry also carries its write-only provenance (Phase 2.5).
    index = {
        "title": title,
        "description": description,
        "pages": [
            {
                "id": s.id,
                "title": s.title,
                "description": s.description,
                "slug": s.slug,
                "importance": s.importance,
                "sources": s.relevant_files,
                "related": s.related_pages,
                "provenance": provenance.get(s.slug),
            }
            for s in specs
        ],
    }
    put_object(f"{WIKI_PREFIX}_index.json", json.dumps(index, indent=2), "application/json")

    # Drift / review queue (Phase 3). Always written (empty list when clean) so
    # the UI can distinguish "no conflicts" from "never generated".
    drift = {
        "generated_at": started_at,
        "drift_count": len(findings),
        "findings": [f.to_dict() for f in findings],
    }
    put_object(f"{WIKI_PREFIX}_drift.json", json.dumps(drift, indent=2), "application/json")

    # Per-run cost record (Phase 5). Tokens are exact; dollars are estimates.
    cost = aggregate_costs()
    run_id = _safe_run_id(started_at)
    finished_at = datetime.now(timezone.utc).isoformat()
    run_record = {
        "run_id": run_id,
        "generated_at": started_at,
        "finished_at": finished_at,
        "model_id": MODEL_ID,
        "draft_model_id": DRAFT_MODEL_ID,
        "wiki_candidates": WIKI_CANDIDATES,
        "page_count": len(specs),
        "source_doc_count": source_doc_count,
        "drift_count": len(findings),
        **cost,
    }
    put_object(
        f"{WIKI_PREFIX}_runs/{run_id}.json",
        json.dumps(run_record, indent=2),
        "application/json",
    )

    # Metadata — drives the "Last indexed" badge in the UI. corpus_sha
    # is the no-change-guard fingerprint: the next run reads it back and
    # short-circuits if the corpus hash hasn't moved. total_cost_usd is the
    # at-a-glance latest-run estimate; drift_count surfaces the review queue.
    meta = {
        "generated_at": started_at,
        "finished_at": finished_at,
        "source_doc_count": source_doc_count,
        "page_count": len(specs),
        "model_id": MODEL_ID,
        "corpus_sha": corpus_sha,
        "drift_count": len(findings),
        "total_cost_usd": cost["total_cost_usd"],
    }
    put_object(f"{WIKI_PREFIX}_meta.json", json.dumps(meta, indent=2), "application/json")


# ── Main ──────────────────────────────────────────────────────────────


def main() -> int:
    started_at = datetime.now(timezone.utc).isoformat()
    t0 = time.monotonic()

    scope = (
        f"prefix={CORPUS_PREFIX}"
        if WIKI_MODE == "code"
        else f"whole bucket (skipping top-level {WIKI_PREFIX})"
    )
    print(f"Listing source docs from s3://{DOCS_BUCKET}/  · {scope}")
    entries = list_corpus_entries()
    if not entries:
        print("No source markdown found — nothing to generate.", file=sys.stderr)
        return 1
    print(f"  {len(entries)} source doc(s)")

    # ── No-change guard ─────────────────────────────────────────────
    # Hash the (key, etag) pairs and compare against corpus_sha persisted
    # in the prior _meta.json. If they match and WIKI_FORCE isn't set, the
    # corpus is byte-identical to what produced the existing wiki — no need
    # to spend on the model regenerating identical content. This is an
    # all-or-nothing "did anything change at all" gate and remains the
    # primary cost saver; per-page reuse is deliberately not built (see
    # build_provenance's DEFERRED note).
    # The EventBridge tick sets no env, so it never forces; the manual
    # "Refresh now" button forwards force=true via start-wiki-gen so
    # users always get a real regen when they ask for one.
    corpus_sha = compute_corpus_sha(entries)
    prior_meta = read_prior_meta()
    prior_sha = prior_meta.get("corpus_sha")
    if prior_sha == corpus_sha and not WIKI_FORCE:
        print(
            f"Corpus unchanged since last regen ({prior_meta.get('finished_at', '?')}). "
            f"Skipping (set WIKI_FORCE=1 to override). sha={corpus_sha[:12]}…"
        )
        return 0
    if WIKI_FORCE and prior_sha == corpus_sha:
        print("WIKI_FORCE=1 — regenerating despite unchanged corpus.")

    docs = load_source_docs(entries)
    docs_by_key = {d.key: d for d in docs}
    corpus_summary = build_corpus_summary(docs)

    print(f"Requesting wiki structure from the model (mode={WIKI_MODE})…")
    structure_template = (
        CODE_STRUCTURE_PROMPT if WIKI_MODE == "code" else STRUCTURE_PROMPT
    )
    structure_prompt = structure_template.format(
        corpus_summary=corpus_summary,
        min_pages=MIN_PAGES,
        max_pages=MAX_PAGES,
        repo_full_name=REPO_FULL_NAME or "this repository",
    )
    structure_raw = invoke_llm(structure_prompt, stage="structure")
    structure_xml = extract_xml(structure_raw)
    title, description, specs = parse_structure(structure_xml, set(docs_by_key))
    print(f"  plan: {len(specs)} page(s)")
    for s in specs:
        print(f"    - {s.id}  {s.title}  ({len(s.relevant_files)} source(s))")

    # DEFERRED: per-page reuse/staleness skip would go here — compare each
    # page's sources against the prior provenance record and skip unchanged
    # pages. Not built: LLM structure runs drift slugs/groupings, so a
    # slug-keyed ledger rarely matches (see build_provenance). We always
    # regenerate every page and focus on conflict resolution (L1/L3).

    # Map: generate candidates per page, then judge-merge (Level 1).
    findings: list[DriftFinding] = []
    page_bodies: dict[str, str] = {}
    for i, spec in enumerate(specs, 1):
        n = WIKI_CANDIDATES if len(spec.relevant_files) >= 2 else 1
        suffix = "" if n == 1 else f" ({n} candidates → judge)"
        print(f"Generating {i}/{len(specs)}: {spec.title}{suffix}")
        body, page_findings = render_page(spec, docs_by_key)
        page_bodies[spec.id] = body
        findings.extend(page_findings)

    # Reduce: cross-page consistency over source-overlapping pairs (Level 3).
    pairs = overlapping_pairs(specs)
    if pairs:
        print(f"Reconciling {len(pairs)} overlapping page-pair(s) (cross-page)…")
        for a, b in pairs:
            reconciled, pair_findings = judge_cross_page(
                a, b, page_bodies[a.id], page_bodies[b.id], docs_by_key
            )
            for pid, new_body in reconciled.items():
                page_bodies[pid] = new_body
            findings.extend(pair_findings)

    if findings:
        print(f"  {len(findings)} drift finding(s) queued for review")

    provenance = build_provenance(specs, docs_by_key, started_at)
    print(
        f"Writing {len(specs)} page(s) + _index.json + _meta.json + _drift.json "
        f"+ _runs/ to s3://{DOCS_BUCKET}/{WIKI_PREFIX}"
    )
    write_wiki_outputs(
        title,
        description,
        specs,
        page_bodies,
        len(docs),
        started_at,
        corpus_sha,
        findings,
        provenance,
    )

    # Drift write-back (Phase 4): no-op/log-only by default. Real adapters
    # require connector secrets granted to the task (deploy prerequisite).
    if findings:
        import drift_actions

        drift_actions.dispatch(
            [f.to_dict() for f in findings],
            enabled=WIKI_DRIFT_WRITEBACK,
            dry_run=WIKI_DRIFT_DRYRUN,
        )

    cost = aggregate_costs()
    total = cost["total_cost_usd"]
    cost_str = f"${total:.4f} (est.)" if total is not None else "tokens-only"
    elapsed = time.monotonic() - t0
    print(
        f"Done in {elapsed:.1f}s · {len(COST_EVENTS)} model call(s) · "
        f"{cost['total_input_tokens']}+{cost['total_output_tokens']} tokens · {cost_str}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
