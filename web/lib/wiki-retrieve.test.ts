import assert from "node:assert/strict";
import { test } from "node:test";

import {
  filterSearchHits,
  keyFromUri,
  searchRetrieveCount,
  searchSourceFilter,
  shouldExcludeFromSearch,
} from "./wiki-retrieve";

test("keyFromUri strips s3://bucket/ from a retrieve location", () => {
  assert.equal(
    keyFromUri("s3://docs-bucket/verify/run/e2e.md"),
    "verify/run/e2e.md"
  );
  assert.equal(keyFromUri("verify/run/e2e.md"), "verify/run/e2e.md");
  assert.equal(keyFromUri(undefined), "");
  assert.equal(keyFromUri("s3://docs-bucket"), "docs-bucket");
});

test("shouldExcludeFromSearch drops wiki prefix and tagged sources", () => {
  assert.equal(shouldExcludeFromSearch("wiki/overview.md", "wiki"), true);
  assert.equal(shouldExcludeFromSearch("wiki/overview.md"), true);
  assert.equal(shouldExcludeFromSearch("wiki/code/acme/auth.md", "code-wiki"), true);
  assert.equal(shouldExcludeFromSearch("sources/github/acme/x.ts", "github"), true);
  assert.equal(shouldExcludeFromSearch("ga4-events.md"), false);
  assert.equal(shouldExcludeFromSearch("domain-knowledge/amplia.md", null), false);
  assert.equal(shouldExcludeFromSearch("sources/notion/events.md", "notion"), false);
});

test("searchSourceFilter is notIn including wiki, not an allowlist", () => {
  assert.deepEqual(searchSourceFilter(), {
    notIn: { key: "source", value: ["github", "code-wiki", "wiki"] },
  });
});

test("filterSearchHits drops wiki/ keys and still fills limit", () => {
  const hits = [
    { key: "wiki/overview.md" },
    { key: "ga4/purchase.md" },
    { key: "wiki/code/repo/page.md" },
    { key: "uploads/runbook.md" },
    { key: "notion/events.md" },
  ];
  const kept = filterSearchHits(hits, 2);
  assert.deepEqual(
    kept.map((h) => h.key),
    ["ga4/purchase.md", "uploads/runbook.md"]
  );
  assert.ok(kept.every((h) => !h.key.startsWith("wiki/")));
  assert.ok(searchRetrieveCount(6) > 6);
});
