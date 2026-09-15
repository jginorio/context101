"""Pure search-exclusion helpers for MCP `search_knowledge`.

Do not blanket-exclude `source=github`: GitHub-synced documentation
(`sources/github/.../docs/*.md`) is often the brain's primary content.
Wiki overlay pages are tagged `source=wiki` / `source=code-wiki` and live
under `wiki/` (including `wiki/code/` and untagged `_index.json`).

Bedrock `notIn` on `source` also matches documents with **no** `source`
attribute (manual uploads have no sidecar), so this cannot become an
allowlist — we exclude wiki via `notIn` *and* by key prefix. GitHub code
files are dropped by path/extension after retrieve.
"""

from __future__ import annotations

from typing import Any

# Metadata denylist for Bedrock retrieve. Never include "github" — that
# hides connector-synced markdown docs.
SEARCH_EXCLUDED_SOURCES = ["code-wiki", "wiki"]
BEDROCK_MAX_RESULTS = 100
SEARCH_LIMIT_MAX = 20

DOC_EXTENSIONS = (".md", ".mdx", ".txt", ".markdown", ".rst")
CODE_EXTENSIONS = (
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".mts",
    ".cts",
    ".py",
    ".go",
    ".rs",
    ".java",
    ".kt",
    ".kts",
    ".scala",
    ".c",
    ".cc",
    ".cpp",
    ".h",
    ".hpp",
    ".cs",
    ".swift",
    ".rb",
    ".php",
    ".lua",
    ".sh",
    ".bash",
    ".zsh",
    ".ps1",
    ".sql",
    ".css",
    ".scss",
    ".vue",
    ".svelte",
)


def _basename(key: str) -> str:
    return key.rsplit("/", 1)[-1].lower()


def _suffix(name: str) -> str:
    if "." not in name:
        return ""
    return "." + name.rsplit(".", 1)[-1]


def looks_like_source_code(key: str) -> bool:
    """True for source-code files, including GitHub wrappers like `x.ts.md`."""
    name = _basename(key)
    if not name:
        return False
    # Connector may wrap code as `<file>.ts.md` for Bedrock ingest.
    for doc_ext in DOC_EXTENSIONS:
        if name.endswith(doc_ext) and name != doc_ext:
            inner = name[: -len(doc_ext)]
            if _suffix(inner) in CODE_EXTENSIONS:
                return True
            return False
    return _suffix(name) in CODE_EXTENSIONS


def is_github_key(key: str, source: str | None = None) -> bool:
    return source == "github" or key.startswith("sources/github/")


def should_exclude_from_search(key: str, source: str | None = None) -> bool:
    """True if a retrieve hit must not appear in search_knowledge results.

    Manual uploads (`source=None`, key not under `wiki/`) stay searchable.
    GitHub-synced `.md` / `.mdx` / `.txt` stay searchable.
    """
    if key.startswith("wiki/"):
        return True
    if source in SEARCH_EXCLUDED_SOURCES:
        return True
    if is_github_key(key, source) and looks_like_source_code(key):
        return True
    return False


def search_source_filter() -> dict[str, Any]:
    """Bedrock vector-search filter: drop tagged wiki overlays, keep github docs."""
    return {"notIn": {"key": "source", "value": list(SEARCH_EXCLUDED_SOURCES)}}


def clamp_search_limit(limit: int) -> int:
    return max(1, min(limit, SEARCH_LIMIT_MAX))


def search_retrieve_count(limit: int) -> int:
    """Ask Bedrock for more than `limit` so a wiki/ post-filter can still fill it."""
    limit = clamp_search_limit(limit)
    return min(BEDROCK_MAX_RESULTS, max(limit * 3, limit + 5))


def source_key_from_retrieval(result: dict[str, Any]) -> str:
    """Extract the S3 object key from a Retrieve result."""
    loc = result.get("location", {}) or {}
    s3_loc = loc.get("s3Location") or {}
    uri = s3_loc.get("uri", "")
    if uri.startswith("s3://"):
        without_scheme = uri[5:]
        return without_scheme.split("/", 1)[1] if "/" in without_scheme else without_scheme
    return uri


def retrieval_source_attr(result: dict[str, Any]) -> str | None:
    meta = result.get("metadata") or {}
    if not isinstance(meta, dict):
        return None
    value = meta.get("source")
    if isinstance(value, str):
        return value
    if isinstance(value, list) and value and isinstance(value[0], str):
        return value[0]
    return None


def filter_search_results(
    results: list[dict[str, Any]], limit: int
) -> list[dict[str, Any]]:
    """Drop wiki overlay + github code, then trim to `limit` (ranking preserved)."""
    limit = clamp_search_limit(limit)
    kept: list[dict[str, Any]] = []
    for result in results:
        key = source_key_from_retrieval(result)
        source = retrieval_source_attr(result)
        if should_exclude_from_search(key, source):
            continue
        kept.append(result)
        if len(kept) >= limit:
            break
    return kept
