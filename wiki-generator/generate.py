"""
Context101 Wiki Generator.

Flow:
  1. List .md files from s3://DOCS_BUCKET/ excluding WIKI_PREFIX.
  2. Build a corpus summary (S3 key + preview of each doc).
  3. Call Opus with the structure prompt → XML plan.
  4. For each page in the plan:
       a. Read the full content of each relevant_file from S3.
       b. Call Opus with the per-page prompt → markdown.
       c. Write s3://DOCS_BUCKET/WIKI_PREFIX/<slug>.md.
       d. Write a .metadata.json sidecar tagging the page source=wiki so
          search_knowledge's source=wiki filter picks it up. Raw docs have
          no sidecar, so they're excluded from canonical retrieval.
  5. Write WIKI_PREFIX/_index.json (nav) and WIKI_PREFIX/_meta.json (timestamp).

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
    CODE_PAGE_PROMPT,
    CODE_STRUCTURE_PROMPT,
    PAGE_PROMPT,
    STRUCTURE_PROMPT,
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
# Opus knows which repo it's documenting. Ignored in main mode.
REPO_FULL_NAME = os.environ.get("REPO_FULL_NAME", "")
MODEL_ID = os.environ.get("MODEL_ID", "us.anthropic.claude-opus-4-7")
# Wiki model provider. "bedrock" (default) uses the keyless Bedrock path via
# the task role. Bring-your-own providers ("anthropic", "openai", "grok",
# "gemini") are routed through LiteLLM with an API key fetched from
# LLM_KEY_SECRET_ARN (a Secrets Manager ARN injected by start-wiki-gen).
MODEL_PROVIDER = os.environ.get("MODEL_PROVIDER", "bedrock").lower()
LLM_KEY_SECRET_ARN = os.environ.get("LLM_KEY_SECRET_ARN")
MIN_PAGES = int(os.environ.get("MIN_PAGES", "4"))
MAX_PAGES = int(os.environ.get("MAX_PAGES", "8"))
CORPUS_PREVIEW_CHARS = int(os.environ.get("CORPUS_PREVIEW_CHARS", "600"))
# Cap the structure-pass corpus summary. A large corpus (thousands of docs)
# can overflow the model's context, and because keys are sorted the *tail*
# (e.g. sources/notion/…, which sorts after sources/github/…) is what gets
# truncated — so freshly connected sources silently never reach the planner.
# Docs are selected round-robin across source areas to stay within this budget
# while keeping every area represented.
CORPUS_SUMMARY_MAX_CHARS = int(
    os.environ.get("CORPUS_SUMMARY_MAX_CHARS", "240000")
)
MAX_TOKENS = int(os.environ.get("MAX_TOKENS", "8192"))
# WIKI_FORCE=1 bypasses the no-change corpus-hash guard. Set by the
# /api/wiki/refresh POST path (manual button) but NOT by the EventBridge
# scheduled tick — so the 10h schedule becomes a near-no-op when nothing
# in the corpus has changed since the last successful regen.
WIKI_FORCE = os.environ.get("WIKI_FORCE", "").lower() in ("1", "true", "yes")

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


@dataclass
class PageSpec:
    id: str
    title: str
    description: str
    importance: str
    relevant_files: list[str]
    related_pages: list[str]
    slug: str  # derived; filename under WIKI_PREFIX


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

    # Main mode: the team wiki is built from non-code sources only. Raw
    # GitHub repo files are represented by their isolated per-repo code wikis
    # (which the team wiki references via a catalog, not by ingesting their
    # content). And we never feed our own wiki output back in — neither the
    # top-level team pages nor the wiki/code/ pages.
    if key.startswith("sources/github/"):
        return True
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


def load_source_docs(keys: list[str]) -> list[SourceDoc]:
    """Body-load pass — only run after the no-change guard decides to regen."""
    docs: list[SourceDoc] = []
    for key in keys:
        obj = s3.get_object(Bucket=DOCS_BUCKET, Key=key)
        body = obj["Body"].read().decode("utf-8", errors="replace")
        docs.append(SourceDoc(key=key, body=body))
    return docs


def _source_area(key: str) -> str:
    """Group a corpus key into a "source area" for representative sampling.

    sources/<provider>/<container>/...  -> "sources/<provider>/<container>"
        (each GitHub repo and each Notion/Google workspace is its own area)
    <top>/...                           -> "<top>/"
    bare-file.md                        -> "(root)"
    """
    parts = key.split("/")
    if parts[0] == "sources" and len(parts) >= 3:
        return "/".join(parts[:3])
    if len(parts) >= 2:
        return parts[0] + "/"
    return "(root)"


def load_code_wiki_catalog() -> tuple[str, list[tuple[str, str]]]:
    """Build a reference catalog of the per-repo code wikis for the team wiki.

    The team wiki doesn't ingest code-wiki content — instead it's handed a
    lightweight catalog (each repo's pages: title, short description, path)
    read from the code wikis' existing `_index.json` files, so generated team
    pages can *optionally* link into a repo's deep wiki when directly relevant.

    Also returns each code wiki's `_meta.json` (key, etag) so a repo change
    (which rewrites that repo's wiki + _meta) flows into the team wiki's
    no-change hash and triggers a refresh of references. Empty catalog when no
    code wikis exist.
    """
    index_keys: list[str] = []
    meta_entries: list[tuple[str, str]] = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=DOCS_BUCKET, Prefix="wiki/code/"):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.endswith("/_index.json"):
                index_keys.append(key)
            elif key.endswith("/_meta.json"):
                meta_entries.append((key, (obj.get("ETag") or "").strip('"')))
    meta_entries.sort()

    blocks: list[str] = []
    for ik in sorted(index_keys):
        try:
            obj = s3.get_object(Bucket=DOCS_BUCKET, Key=ik)
            idx = json.loads(obj["Body"].read().decode("utf-8"))
        except Exception as e:
            print(f"  [warn] couldn't read code wiki index {ik}: {e}", file=sys.stderr)
            continue
        repo_prefix = ik[: -len("_index.json")]  # "wiki/code/<repo>/"
        lines = [f"Repo wiki: {idx.get('title') or repo_prefix}"]
        desc = (idx.get("description") or "").strip()
        if desc:
            lines.append(f"  {desc}")
        for p in idx.get("pages", []):
            slug = p.get("slug")
            if not slug:
                continue
            path = f"{repo_prefix}{slug}.md"
            pdesc = (p.get("description") or "").strip()
            lines.append(
                f"  - {p.get('title', 'Untitled')} → {path}"
                + (f" — {pdesc}" if pdesc else "")
            )
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks), meta_entries


def build_corpus_summary(docs: list[SourceDoc]) -> tuple[str, int]:
    """Render the structure-pass corpus summary, budgeted and representative.

    Rather than concatenating every preview in key order (which lets a huge
    area like a code repo crowd out — or truncate — small areas like a freshly
    connected Notion workspace), group docs by source area and fill the summary
    round-robin: every area contributes its first doc before any area
    contributes its second, until CORPUS_SUMMARY_MAX_CHARS is reached.

    Returns (summary_xml, included_doc_count).
    """
    groups: dict[str, list[SourceDoc]] = {}
    for d in docs:
        groups.setdefault(_source_area(d.key), []).append(d)
    for g in groups.values():
        g.sort(key=lambda d: d.key)
    ordered_groups = [groups[k] for k in sorted(groups)]

    parts: list[str] = []
    used = 0
    included = 0
    idx = 0
    while True:
        progressed = False
        for g in ordered_groups:
            if idx >= len(g):
                continue
            progressed = True
            d = g[idx]
            preview = d.body.strip()[:CORPUS_PREVIEW_CHARS]
            block = f"<doc path=\"{d.key}\">\n{preview}\n</doc>"
            # Always include at least one doc; otherwise honor the budget.
            if included > 0 and used + len(block) > CORPUS_SUMMARY_MAX_CHARS:
                return "\n\n".join(parts), included
            parts.append(block)
            used += len(block) + 2
            included += 1
        if not progressed:
            break
        idx += 1
    return "\n\n".join(parts), included


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


def _invoke_bedrock(user_text: str) -> str:
    """Single-turn Converse call to a Bedrock model. Returns assistant text."""
    resp = bedrock.converse(
        modelId=MODEL_ID,
        messages=[{"role": "user", "content": [{"text": user_text}]}],
        inferenceConfig={"maxTokens": MAX_TOKENS},
    )
    content = resp["output"]["message"]["content"]
    return "".join(block.get("text", "") for block in content).strip()


def _invoke_litellm(user_text: str) -> str:
    """Single-turn completion via LiteLLM for bring-your-own providers."""
    import litellm

    prefix = _LITELLM_PREFIX.get(MODEL_PROVIDER)
    if not prefix:
        raise RuntimeError(f"Unsupported wiki model provider: {MODEL_PROVIDER}")
    if not MODEL_ID:
        raise RuntimeError(f"MODEL_ID is required for provider '{MODEL_PROVIDER}'.")

    resp = litellm.completion(
        model=f"{prefix}/{MODEL_ID}",
        messages=[{"role": "user", "content": user_text}],
        max_tokens=MAX_TOKENS,
        api_key=_llm_api_key(),
    )
    return (resp.choices[0].message.content or "").strip()


def invoke_llm(user_text: str) -> str:
    """Single-turn LLM call routed to the configured provider."""
    if MODEL_PROVIDER == "bedrock":
        return _invoke_bedrock(user_text)
    return _invoke_litellm(user_text)


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


# ── Per-page generation ──────────────────────────────────────────────


def generate_page(
    spec: PageSpec,
    docs_by_key: dict[str, SourceDoc],
    code_wiki_catalog: str = "",
) -> str:
    if not spec.relevant_files:
        raise ValueError(f"Page {spec.id} ({spec.title}) has no relevant_files")

    source_blocks = []
    for key in spec.relevant_files:
        doc = docs_by_key[key]
        source_blocks.append(f'<file path="{doc.key}">\n{doc.body}\n</file>')
    source_content = "\n\n".join(source_blocks)

    template = CODE_PAGE_PROMPT if WIKI_MODE == "code" else PAGE_PROMPT
    prompt = template.format(
        page_title=spec.title,
        page_description=spec.description,
        source_content=source_content,
        code_wikis=code_wiki_catalog or "(none)",
        repo_full_name=REPO_FULL_NAME or "this repository",
    )
    return invoke_llm(prompt)


# ── S3 writes ─────────────────────────────────────────────────────────


def put_object(key: str, body: str, content_type: str) -> None:
    s3.put_object(
        Bucket=DOCS_BUCKET,
        Key=key,
        Body=body.encode("utf-8"),
        ContentType=content_type,
    )


def list_keys_under(prefix: str) -> list[str]:
    keys: list[str] = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=DOCS_BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            keys.append(obj["Key"])
    return keys


def delete_keys(keys: list[str]) -> None:
    for i in range(0, len(keys), 1000):
        batch = [{"Key": k} for k in keys[i : i + 1000]]
        s3.delete_objects(Bucket=DOCS_BUCKET, Delete={"Objects": batch, "Quiet": True})




def build_wiki_sidecar(slug: str, started_at: str) -> dict:
    # Bedrock S3 Vectors *ignores a metadata sidecar entirely* if the file
    # exceeds 1024 bytes — which silently strips `source`, making the page
    # invisible to search_knowledge's `source=wiki` filter. So keep this tiny:
    # only the attributes we actually filter on. Page provenance lives in the
    # body's inline `Sources: [file]()` citations, not here.
    #
    # `source` drives search_knowledge's filter — only "wiki" is canonical for
    # top-level retrieval. "code-wiki" pages stay in the index but aren't
    # returned by search_knowledge unless read via citations or read_knowledge.
    source_tag = "code-wiki" if WIKI_MODE == "code" else "wiki"
    attrs: dict = {
        "source": source_tag,
        "generated_at": started_at,
        "page_slug": slug,
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
) -> None:
    # Track every key this run writes so we can prune stale pages below.
    fresh_keys: set[str] = set()

    # Pages + sidecars. Write the sidecar first so the next auto-ingest
    # run sees both files together and attaches metadata on first pass.
    for spec in specs:
        body = page_bodies[spec.id]
        md_key = f"{WIKI_PREFIX}{spec.slug}.md"
        sidecar = build_wiki_sidecar(spec.slug, started_at)
        put_object(
            f"{md_key}.metadata.json",
            json.dumps(sidecar),
            "application/json",
        )
        put_object(md_key, body, "text/markdown; charset=utf-8")
        fresh_keys.add(md_key)
        fresh_keys.add(f"{md_key}.metadata.json")

    # Nav index — maps page id → slug/title, preserves order + related links.
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
            }
            for s in specs
        ],
    }
    put_object(f"{WIKI_PREFIX}_index.json", json.dumps(index, indent=2), "application/json")
    fresh_keys.add(f"{WIKI_PREFIX}_index.json")

    # Metadata — drives the "Last indexed" badge in the UI. corpus_sha
    # is the no-change-guard fingerprint: the next run reads it back and
    # short-circuits if the corpus hash hasn't moved.
    meta = {
        "generated_at": started_at,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "source_doc_count": source_doc_count,
        "page_count": len(specs),
        "model_id": MODEL_ID,
        "corpus_sha": corpus_sha,
    }
    put_object(f"{WIKI_PREFIX}_meta.json", json.dumps(meta, indent=2), "application/json")
    fresh_keys.add(f"{WIKI_PREFIX}_meta.json")

    # Prune stale pages from prior runs. Opus picks different page titles each
    # run, so slugs (and thus filenames) drift — without pruning, every run
    # leaves its old pages behind and they pile up in the KB vector index,
    # polluting search with dozens of overlapping, outdated pages. Delete any
    # object under WIKI_PREFIX that this run didn't just write. In main mode,
    # never touch the nested code wikis under wiki/code/ (they're produced by
    # separate per-repo runs).
    existing = list_keys_under(WIKI_PREFIX)
    stale = [
        k
        for k in existing
        if k not in fresh_keys
        and not (WIKI_MODE != "code" and k.startswith(f"{WIKI_PREFIX}code/"))
    ]
    if stale:
        delete_keys(stale)
        print(f"  pruned {len(stale)} stale wiki object(s) from prior runs")


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
    # corpus is byte-identical to what produced the existing wiki — no
    # need to spend ~$0.30-0.80 on Opus regenerating identical content.
    # The EventBridge tick sets no env, so it never forces; the manual
    # "Refresh now" button forwards force=true via start-wiki-gen so
    # users always get a real regen when they ask for one.
    # Per-repo code wikis are referenced, not ingested. Load their catalog
    # (for the prompts) and fold each code wiki's _meta.json (key, etag) into
    # the hash, so a repo change flows into the team wiki's no-change guard and
    # triggers a refresh of references.
    code_wiki_catalog = ""
    code_meta_entries: list[tuple[str, str]] = []
    if WIKI_MODE != "code":
        code_wiki_catalog, code_meta_entries = load_code_wiki_catalog()
        if code_meta_entries:
            print(f"  {len(code_meta_entries)} code wiki(s) available to reference")

    corpus_sha = compute_corpus_sha(sorted(entries + code_meta_entries))
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

    docs = load_source_docs([k for k, _ in entries])
    docs_by_key = {d.key: d for d in docs}
    corpus_summary, summary_docs = build_corpus_summary(docs)
    if summary_docs < len(docs):
        print(
            f"  structure corpus: {summary_docs}/{len(docs)} docs "
            f"(round-robin across source areas, capped at "
            f"{CORPUS_SUMMARY_MAX_CHARS} chars)"
        )

    print(f"Requesting wiki structure from Opus (mode={WIKI_MODE})…")
    structure_template = (
        CODE_STRUCTURE_PROMPT if WIKI_MODE == "code" else STRUCTURE_PROMPT
    )
    structure_prompt = structure_template.format(
        corpus_summary=corpus_summary,
        code_wikis=code_wiki_catalog or "(none)",
        min_pages=MIN_PAGES,
        max_pages=MAX_PAGES,
        repo_full_name=REPO_FULL_NAME or "this repository",
    )
    structure_raw = invoke_llm(structure_prompt)
    structure_xml = extract_xml(structure_raw)
    title, description, specs = parse_structure(structure_xml, set(docs_by_key))
    print(f"  plan: {len(specs)} page(s)")
    for s in specs:
        print(f"    - {s.id}  {s.title}  ({len(s.relevant_files)} source(s))")

    page_bodies: dict[str, str] = {}
    for i, spec in enumerate(specs, 1):
        print(f"Generating {i}/{len(specs)}: {spec.title}")
        body = generate_page(spec, docs_by_key, code_wiki_catalog)
        page_bodies[spec.id] = body

    print(f"Writing {len(specs)} page(s) + _index.json + _meta.json to s3://{DOCS_BUCKET}/{WIKI_PREFIX}")
    write_wiki_outputs(
        title, description, specs, page_bodies, len(docs), started_at, corpus_sha
    )

    elapsed = time.monotonic() - t0
    print(f"Done in {elapsed:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
