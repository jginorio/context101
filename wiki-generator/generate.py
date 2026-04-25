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
MIN_PAGES = int(os.environ.get("MIN_PAGES", "4"))
MAX_PAGES = int(os.environ.get("MAX_PAGES", "8"))
CORPUS_PREVIEW_CHARS = int(os.environ.get("CORPUS_PREVIEW_CHARS", "600"))
MAX_TOKENS = int(os.environ.get("MAX_TOKENS", "8192"))

if not WIKI_PREFIX.endswith("/"):
    WIKI_PREFIX += "/"
if CORPUS_PREFIX and not CORPUS_PREFIX.endswith("/"):
    CORPUS_PREFIX += "/"


# ── AWS clients ───────────────────────────────────────────────────────

_session = boto3.Session(region_name=AWS_REGION, profile_name=AWS_PROFILE)
_cfg = Config(retries={"max_attempts": 5, "mode": "adaptive"}, read_timeout=300)

s3 = _session.client("s3", config=_cfg)
bedrock = _session.client("bedrock-runtime", config=_cfg)


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

    # Main mode: skip top-level wiki/<slug>.md (avoid feeding our own
    # output back in), but keep wiki/code/<repo>/<slug>.md so the team
    # wiki can cite pre-synthesized code-wiki pages.
    if key.startswith("wiki/code/"):
        return False
    if key.startswith("wiki/"):
        return True
    return False


def list_source_docs() -> list[SourceDoc]:
    """List markdown files in the docs bucket, mode-aware."""
    keys: list[str] = []
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
            keys.append(key)

    docs: list[SourceDoc] = []
    for key in sorted(keys):
        obj = s3.get_object(Bucket=DOCS_BUCKET, Key=key)
        body = obj["Body"].read().decode("utf-8", errors="replace")
        docs.append(SourceDoc(key=key, body=body))
    return docs


def build_corpus_summary(docs: list[SourceDoc]) -> str:
    parts = []
    for d in docs:
        preview = d.body.strip()[:CORPUS_PREVIEW_CHARS]
        parts.append(f"<doc path=\"{d.key}\">\n{preview}\n</doc>")
    return "\n\n".join(parts)


# ── Bedrock call ──────────────────────────────────────────────────────


def invoke_opus(user_text: str) -> str:
    """Single-turn Converse call to Opus. Returns the assistant text."""
    resp = bedrock.converse(
        modelId=MODEL_ID,
        messages=[{"role": "user", "content": [{"text": user_text}]}],
        inferenceConfig={"maxTokens": MAX_TOKENS},
    )
    content = resp["output"]["message"]["content"]
    return "".join(block.get("text", "") for block in content).strip()


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


def generate_page(spec: PageSpec, docs_by_key: dict[str, SourceDoc]) -> str:
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
        repo_full_name=REPO_FULL_NAME or "this repository",
    )
    return invoke_opus(prompt)


# ── S3 writes ─────────────────────────────────────────────────────────


def put_object(key: str, body: str, content_type: str) -> None:
    s3.put_object(
        Bucket=DOCS_BUCKET,
        Key=key,
        Body=body.encode("utf-8"),
        ContentType=content_type,
    )


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

    # Metadata — drives the "Last indexed" badge in the UI.
    meta = {
        "generated_at": started_at,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "source_doc_count": source_doc_count,
        "page_count": len(specs),
        "model_id": MODEL_ID,
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
    docs = list_source_docs()
    if not docs:
        print("No source markdown found — nothing to generate.", file=sys.stderr)
        return 1
    print(f"  {len(docs)} source doc(s)")

    docs_by_key = {d.key: d for d in docs}
    corpus_summary = build_corpus_summary(docs)

    print(f"Requesting wiki structure from Opus (mode={WIKI_MODE})…")
    structure_template = (
        CODE_STRUCTURE_PROMPT if WIKI_MODE == "code" else STRUCTURE_PROMPT
    )
    structure_prompt = structure_template.format(
        corpus_summary=corpus_summary,
        min_pages=MIN_PAGES,
        max_pages=MAX_PAGES,
        repo_full_name=REPO_FULL_NAME or "this repository",
    )
    structure_raw = invoke_opus(structure_prompt)
    structure_xml = extract_xml(structure_raw)
    title, description, specs = parse_structure(structure_xml, set(docs_by_key))
    print(f"  plan: {len(specs)} page(s)")
    for s in specs:
        print(f"    - {s.id}  {s.title}  ({len(s.relevant_files)} source(s))")

    page_bodies: dict[str, str] = {}
    for i, spec in enumerate(specs, 1):
        print(f"Generating {i}/{len(specs)}: {spec.title}")
        body = generate_page(spec, docs_by_key)
        page_bodies[spec.id] = body

    print(f"Writing {len(specs)} page(s) + _index.json + _meta.json to s3://{DOCS_BUCKET}/{WIKI_PREFIX}")
    write_wiki_outputs(title, description, specs, page_bodies, len(docs), started_at)

    elapsed = time.monotonic() - t0
    print(f"Done in {elapsed:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
