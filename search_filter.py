"""Pure search-exclusion helpers for MCP `search_knowledge`.

Wiki overview pages are tagged `source=wiki` in `.metadata.json` sidecars
(see wiki-generator-ts/src/outputs.ts) and live under the `wiki/` S3 prefix
(including `wiki/code/`). Bedrock `notIn` on `source` also matches documents
with **no** `source` attribute (manual uploads have no sidecar), so this
cannot become an allowlist — we exclude wiki via `notIn` *and* by key prefix.
"""

from __future__ import annotations

from typing import Any

SEARCH_EXCLUDED_SOURCES = ["github", "code-wiki", "wiki"]
BEDROCK_MAX_RESULTS = 100
SEARCH_LIMIT_MAX = 20


def should_exclude_from_search(key: str, source: str | None = None) -> bool:
    """True if a retrieve hit must not appear in search_knowledge results.

    Manual uploads (`source=None`, key not under `wiki/`) stay searchable.
    """
    if source in SEARCH_EXCLUDED_SOURCES:
        return True
    return key.startswith("wiki/")


def search_source_filter() -> dict[str, Any]:
    """Bedrock vector-search filter: everything except excluded sources."""
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
    """Drop wiki/code hits, then trim to `limit` (Bedrock ranking preserved)."""
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
