import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyDeleteToKeys,
  applyRenameToKeys,
  isRemovedByDelete,
  remapKeyAfterRename,
} from "./knowledge-keys";

test("remaps a file key on rename", () => {
  assert.equal(
    remapKeyAfterRename("notes.md", "notes.md", "renamed.md", false),
    "renamed.md"
  );
  assert.equal(
    remapKeyAfterRename("other.md", "notes.md", "renamed.md", false),
    "other.md"
  );
});

test("remaps a file under a renamed folder", () => {
  assert.equal(
    remapKeyAfterRename(
      "analytics/directory-analytics.md",
      "analytics/",
      "reports/",
      true
    ),
    "reports/directory-analytics.md"
  );
  assert.equal(
    remapKeyAfterRename("wiki/page.md", "analytics/", "reports/", true),
    "wiki/page.md"
  );
});

test("applyRenameToKeys updates matching tabs only", () => {
  assert.deepEqual(
    applyRenameToKeys(
      ["analytics/a.md", "notes.md"],
      "analytics/",
      "reports/",
      true
    ),
    ["reports/a.md", "notes.md"]
  );
  assert.deepEqual(
    applyRenameToKeys(["notes.md", "other.md"], "notes.md", "renamed.md", false),
    ["renamed.md", "other.md"]
  );
});

test("isRemovedByDelete matches a file or everything under a folder", () => {
  assert.equal(isRemovedByDelete("notes.md", "notes.md", false), true);
  assert.equal(isRemovedByDelete("other.md", "notes.md", false), false);
  assert.equal(
    isRemovedByDelete("analytics/a.md", "analytics/", true),
    true
  );
  assert.equal(isRemovedByDelete("wiki/page.md", "analytics/", true), false);
});

test("applyDeleteToKeys drops the deleted file or folder contents", () => {
  assert.deepEqual(
    applyDeleteToKeys(["notes.md", "other.md"], "notes.md", false),
    ["other.md"]
  );
  assert.deepEqual(
    applyDeleteToKeys(
      ["analytics/a.md", "analytics/b.md", "notes.md"],
      "analytics/",
      true
    ),
    ["notes.md"]
  );
});
