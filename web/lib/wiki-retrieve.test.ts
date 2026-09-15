import assert from "node:assert/strict";
import { test } from "node:test";

import {
  filterSearchHits,
  keyFromUri,
  searchRetrieveCount,
  searchSourceFilter,
  shouldExcludeFromSearch,
} from "./wiki-retrieve";

const ga4Doc = "sources/github/platea/apps/docs/ga4-events.md";

test("keyFromUri strips s3://bucket/ from a retrieve location", () => {
  assert.equal(
    keyFromUri("s3://docs-bucket/verify/run/e2e.md"),
    "verify/run/e2e.md"
  );
  assert.equal(keyFromUri("verify/run/e2e.md"), "verify/run/e2e.md");
  assert.equal(keyFromUri(undefined), "");
  assert.equal(keyFromUri("s3://docs-bucket"), "docs-bucket");
});

test("github markdown docs are searchable", () => {
  assert.equal(shouldExcludeFromSearch(ga4Doc, "github"), false);
  assert.equal(
    shouldExcludeFromSearch("sources/github/acme/docs/auth.mdx", "github"),
    false
  );
  assert.equal(
    shouldExcludeFromSearch("sources/github/acme/README.txt", "github"),
    false
  );
  assert.equal(shouldExcludeFromSearch(ga4Doc), false);
});

test("wiki overview and code-wiki paths are not searchable", () => {
  assert.equal(shouldExcludeFromSearch("wiki/overview.md", "wiki"), true);
  assert.equal(shouldExcludeFromSearch("wiki/overview.md"), true);
  assert.equal(
    shouldExcludeFromSearch("wiki/code/acme/auth.md", "code-wiki"),
    true
  );
  assert.equal(shouldExcludeFromSearch("wiki/code/acme/_index.json"), true);
});

test("github .ts source is not searchable", () => {
  assert.equal(
    shouldExcludeFromSearch("sources/github/acme/src/x.ts", "github"),
    true
  );
  assert.equal(shouldExcludeFromSearch("sources/github/acme/src/x.ts"), true);
  assert.equal(
    shouldExcludeFromSearch("sources/github/acme/src/x.ts.md", "github"),
    true
  );
});

test("manual uploads and notion stay searchable", () => {
  assert.equal(shouldExcludeFromSearch("ga4-events.md"), false);
  assert.equal(shouldExcludeFromSearch("domain-knowledge/amplia.md", null), false);
  assert.equal(
    shouldExcludeFromSearch("sources/notion/events.md", "notion"),
    false
  );
});

test("searchSourceFilter is notIn wiki/code-wiki, not github", () => {
  assert.deepEqual(searchSourceFilter(), {
    notIn: { key: "source", value: ["code-wiki", "wiki"] },
  });
});

test("filterSearchHits keeps github md, drops wiki and ts", () => {
  const hits = [
    { key: "wiki/overview.md", source: "wiki" },
    { key: "wiki/code/platea/_index.json" },
    { key: "sources/github/acme/src/client.ts", source: "github" },
    { key: ga4Doc, source: "github" },
    { key: "uploads/runbook.md" },
  ];
  const kept = filterSearchHits(hits, 5);
  assert.deepEqual(
    kept.map((h) => h.key),
    [ga4Doc, "uploads/runbook.md"]
  );
  assert.ok(kept.every((h) => !h.key.startsWith("wiki/")));
  assert.ok(searchRetrieveCount(6) > 6);
});
