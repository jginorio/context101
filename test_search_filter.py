"""Unit tests for raw-docs search exclusion (no AWS)."""

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


GA4_DOC = "sources/github/platea/apps/docs/ga4-events.md"


class ShouldExcludeFromSearch(unittest.TestCase):
    def test_github_markdown_docs_are_searchable(self) -> None:
        self.assertFalse(should_exclude_from_search(GA4_DOC, "github"))
        self.assertFalse(
            should_exclude_from_search(
                "sources/github/acme/docs/auth.mdx", "github"
            )
        )
        self.assertFalse(
            should_exclude_from_search("sources/github/acme/README.txt", "github")
        )
        self.assertFalse(should_exclude_from_search(GA4_DOC, None))

    def test_wiki_overview_and_code_wiki_are_not(self) -> None:
        self.assertTrue(should_exclude_from_search("wiki/overview.md", "wiki"))
        self.assertTrue(should_exclude_from_search("wiki/overview.md", None))
        self.assertTrue(
            should_exclude_from_search("wiki/code/acme/auth.md", "code-wiki")
        )
        self.assertTrue(should_exclude_from_search("wiki/code/acme/auth.md", None))
        self.assertTrue(
            should_exclude_from_search("wiki/code/acme/_index.json", None)
        )

    def test_github_ts_source_is_not_searchable(self) -> None:
        self.assertTrue(
            should_exclude_from_search("sources/github/acme/src/x.ts", "github")
        )
        self.assertTrue(
            should_exclude_from_search("sources/github/acme/src/x.ts", None)
        )
        self.assertTrue(
            should_exclude_from_search("sources/github/acme/src/x.ts.md", "github")
        )
        self.assertTrue(
            should_exclude_from_search("sources/github/acme/app.py", "github")
        )

    def test_manual_upload_without_source_stays_in(self) -> None:
        self.assertFalse(should_exclude_from_search("ga4-events.md", None))
        self.assertFalse(should_exclude_from_search("domain-knowledge/amplia.md"))
        self.assertFalse(
            should_exclude_from_search("connectors/notion/events.md", "notion")
        )

    def test_tagged_wiki_without_prefix_still_excluded(self) -> None:
        self.assertTrue(should_exclude_from_search("legacy-overview.md", "wiki"))
        self.assertTrue(should_exclude_from_search("legacy-code.md", "code-wiki"))


class SearchSourceFilter(unittest.TestCase):
    def test_notin_excludes_wiki_not_github(self) -> None:
        filt = search_source_filter()
        self.assertIn("notIn", filt)
        self.assertEqual(filt["notIn"]["key"], "source")
        self.assertEqual(filt["notIn"]["value"], ["code-wiki", "wiki"])
        self.assertNotIn("github", filt["notIn"]["value"])
        self.assertEqual(SEARCH_EXCLUDED_SOURCES, ["code-wiki", "wiki"])


class FilterSearchResults(unittest.TestCase):
    def test_keeps_github_md_drops_wiki_and_ts(self) -> None:
        results = [
            _hit("wiki/overview.md", "wiki"),
            _hit("wiki/code/platea/_index.json"),
            _hit("sources/github/acme/src/client.ts", "github"),
            _hit(GA4_DOC, "github"),
            _hit("wiki/code/acme/page.md", "code-wiki"),
            _hit("uploads/runbook.md"),
        ]
        kept = filter_search_results(results, limit=5)
        keys = [source_key_from_retrieval(r) for r in kept]
        self.assertEqual(keys, [GA4_DOC, "uploads/runbook.md"])
        self.assertTrue(all(not k.startswith("wiki/") for k in keys))
        self.assertTrue(all(not k.endswith(".ts") for k in keys))

    def test_overfetch_fills_limit_after_dropping_wiki_junk(self) -> None:
        results = [
            _hit("wiki/code/x/_index.json"),
            _hit("wiki/overview.md", "wiki"),
            _hit(GA4_DOC, "github"),
            _hit("sources/github/acme/docs/funnels.md", "github"),
        ]
        kept = filter_search_results(results, limit=2)
        keys = [source_key_from_retrieval(r) for r in kept]
        self.assertEqual(
            keys,
            [GA4_DOC, "sources/github/acme/docs/funnels.md"],
        )

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
