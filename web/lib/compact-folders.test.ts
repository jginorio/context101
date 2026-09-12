import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compactFolder,
  compactedChildrenToExpand,
  isSingleChildFolder,
  nextCompactPrefetchKey,
  type CompactListingState,
} from "./compact-folders";

function loaded(
  folders: { key: string; name: string }[],
  files: { key: string; name: string }[] = []
): CompactListingState {
  return { status: "loaded", data: { folders, files } };
}

test("isSingleChildFolder requires exactly one folder and no files", () => {
  assert.equal(
    isSingleChildFolder({
      folders: [{ key: "apps/", name: "apps" }],
      files: [],
    }),
    true
  );
  assert.equal(
    isSingleChildFolder({
      folders: [
        { key: "apps/", name: "apps" },
        { key: "docs/", name: "docs" },
      ],
      files: [],
    }),
    false
  );
  assert.equal(
    isSingleChildFolder({
      folders: [{ key: "apps/", name: "apps" }],
      files: [{ key: "readme.md", name: "readme.md" }],
    }),
    false
  );
});

test("nextCompactPrefetchKey follows the only child folder", () => {
  assert.equal(
    nextCompactPrefetchKey({
      folders: [{ key: "apps/plateapr.com/", name: "plateapr.com" }],
      files: [],
    }),
    "apps/plateapr.com/"
  );
  assert.equal(
    nextCompactPrefetchKey({
      folders: [{ key: "apps/", name: "apps" }],
      files: [{ key: "readme.md", name: "readme.md" }],
    }),
    null
  );
});

test("compactFolder joins a single-child chain into one path", () => {
  const listings: Record<string, CompactListingState> = {
    "apps/": loaded([{ key: "apps/plateapr.com/", name: "plateapr.com" }]),
    "apps/plateapr.com/": loaded([
      { key: "apps/plateapr.com/docs/", name: "docs" },
    ]),
    "apps/plateapr.com/docs/": loaded(
      [],
      [{ key: "apps/plateapr.com/docs/nav.md", name: "nav.md" }]
    ),
  };

  const resolved = compactFolder({ key: "apps/", name: "apps" }, listings);
  assert.deepEqual(resolved.segments, ["apps", "plateapr.com", "docs"]);
  assert.equal(resolved.name, "apps/plateapr.com/docs");
  assert.equal(resolved.key, "apps/plateapr.com/docs/");
});

test("compactFolder stops when a folder has files or multiple children", () => {
  const listings: Record<string, CompactListingState> = {
    "apps/": loaded(
      [{ key: "apps/www/", name: "www" }],
      [{ key: "apps/readme.md", name: "readme.md" }]
    ),
  };
  const withFile = compactFolder({ key: "apps/", name: "apps" }, listings);
  assert.equal(withFile.name, "apps");
  assert.equal(withFile.key, "apps/");

  const branched: Record<string, CompactListingState> = {
    "apps/": loaded([
      { key: "apps/web/", name: "web" },
      { key: "apps/api/", name: "api" },
    ]),
  };
  const withSiblings = compactFolder({ key: "apps/", name: "apps" }, branched);
  assert.equal(withSiblings.name, "apps");
});

test("compactFolder stops at a listing that is still loading", () => {
  const listings: Record<string, CompactListingState> = {
    "apps/": loaded([{ key: "apps/plateapr.com/", name: "plateapr.com" }]),
    "apps/plateapr.com/": { status: "loading" },
  };
  const resolved = compactFolder({ key: "apps/", name: "apps" }, listings);
  assert.equal(resolved.name, "apps/plateapr.com");
  assert.equal(resolved.key, "apps/plateapr.com/");
});

test("compactedChildrenToExpand returns deepest keys of joined paths", () => {
  const listings: Record<string, CompactListingState> = {
    "sources/github/repo/": loaded([{ key: "apps/", name: "apps" }]),
    "apps/": loaded([{ key: "apps/plateapr.com/", name: "plateapr.com" }]),
    "apps/plateapr.com/": loaded([
      { key: "apps/plateapr.com/docs/", name: "docs" },
    ]),
    "apps/plateapr.com/docs/": loaded(
      [],
      [{ key: "apps/plateapr.com/docs/nav.md", name: "nav.md" }]
    ),
  };

  assert.deepEqual(
    compactedChildrenToExpand("sources/github/repo/", listings),
    ["apps/plateapr.com/docs/"]
  );
  assert.deepEqual(compactedChildrenToExpand("apps/plateapr.com/docs/", listings), []);
});
