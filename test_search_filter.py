"""Unit tests for raw-docs-only search exclusion (no AWS)."""

from __future__ import annotations

import unittest

from search_filter import (
    SEARCH_EXCLUDED_SOURCES,
    clamp_search_limit,
    filter_search_results,
    search_retrieve_count,
    search_source_filter,
    should_exclude_from_search,
    source_key_from_retrieval,
)


def _hit(key: str, source: str | None = None) -> dict:
    uri = f"s3://docs-bucket/{key}" if key else "s3://docs-bucket"
    result: dict = {
        "location": {"s3Location": {"uri": uri}},
        "content": {"text": key},
        "score": 0.9,
    }
    if source is not None:
        result["metadata"] = {"source": source}
    return result


class ShouldExcludeFromSearch(unittest.TestCase):
    def test_wiki_source_and_prefix(self) -> None:
        self.assertTrue(should_exclude_from_search("wiki/overview.md", "wiki"))
        self.assertTrue(should_exclude_from_search("wiki/overview.md", None))
        self.assertTrue(
            should_exclude_from_search("wiki/code/acme/auth.md", "code-wiki")
        )
        self.assertTrue(should_exclude_from_search("wiki/code/acme/auth.md", None))

    def test_code_sources(self) -> None:
        self.assertTrue(
            should_exclude_from_search("sources/github/acme/src/x.ts", "github")
        )
        self.assertTrue(
            should_exclude_from_search("wiki/code/acme/page.md", "code-wiki")
        )

    def test_manual_upload_without_source_stays_in(self) -> None:
        self.assertFalse(should_exclude_from_search("ga4-events.md", None))
        self.assertFalse(should_exclude_from_search("domain-knowledge/amplia.md"))
        self.assertFalse(
            should_exclude_from_search("connectors/notion/events.md", "notion")
        )

    def test_tagged_wiki_without_prefix_still_excluded(self) -> None:
        self.assertTrue(should_exclude_from_search("legacy-overview.md", "wiki"))


class SearchSourceFilter(unittest.TestCase):
    def test_notin_includes_wiki_not_allowlist(self) -> None:
        filt = search_source_filter()
        self.assertIn("notIn", filt)
        self.assertEqual(filt["notIn"]["key"], "source")
        self.assertEqual(
            filt["notIn"]["value"], ["github", "code-wiki", "wiki"]
        )
        self.assertEqual(SEARCH_EXCLUDED_SOURCES, ["github", "code-wiki", "wiki"])
        # An allowlist would drop manual uploads (no source attr). notIn keeps them.


class FilterSearchResults(unittest.TestCase):
    def test_drops_wiki_keys_and_fills_limit_from_overfetch(self) -> None:
        results = [
            _hit("wiki/overview.md", "wiki"),
            _hit("ga4/purchase.md"),
            _hit("wiki/code/repo/page.md", "code-wiki"),
            _hit("uploads/runbook.md"),
            _hit("wiki/index.md"),
            _hit("notion/events.md", "notion"),
        ]
        kept = filter_search_results(results, limit=2)
        keys = [source_key_from_retrieval(r) for r in kept]
        self.assertEqual(keys, ["ga4/purchase.md", "uploads/runbook.md"])
        self.assertTrue(all(not k.startswith("wiki/") for k in keys))

    def test_trims_to_limit_after_filter(self) -> None:
        results = [_hit(f"doc-{i}.md") for i in range(8)]
        kept = filter_search_results(results, limit=3)
        self.assertEqual(len(kept), 3)
        self.assertEqual(source_key_from_retrieval(kept[0]), "doc-0.md")

    def test_source_key_from_s3_uri(self) -> None:
        self.assertEqual(
            source_key_from_retrieval(_hit("wiki/overview.md")),
            "wiki/overview.md",
        )
        self.assertEqual(
            source_key_from_retrieval(
                {"location": {"s3Location": {"uri": "s3://bucket"}}}
            ),
            "bucket",
        )

    def test_overfetch_is_above_limit_and_capped(self) -> None:
        self.assertGreater(search_retrieve_count(5), 5)
        self.assertEqual(clamp_search_limit(99), 20)
        self.assertLessEqual(search_retrieve_count(20), 100)


if __name__ == "__main__":
    unittest.main()
