import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computeMoveTarget,
  currentParentOf,
  isTreeMoveDrag,
  itemName,
  normalizeDestPrefix,
  parseDragPayload,
} from "./knowledge-move";

test("itemName strips the parent prefix and folder slash", () => {
  assert.equal(itemName("notes.md", false), "notes.md");
  assert.equal(itemName("analytics/a.md", false), "a.md");
  assert.equal(itemName("analytics/", true), "analytics");
  assert.equal(itemName("a/b/", true), "b");
});

test("currentParentOf returns the containing folder prefix", () => {
  assert.equal(currentParentOf("notes.md", false), "");
  assert.equal(currentParentOf("analytics/a.md", false), "analytics/");
  assert.equal(currentParentOf("a/b/c.md", false), "a/b/");
  assert.equal(currentParentOf("analytics/", true), "");
  assert.equal(currentParentOf("a/b/", true), "a/");
});

test("normalizeDestPrefix always ends with a slash except root", () => {
  assert.equal(normalizeDestPrefix(""), "");
  assert.equal(normalizeDestPrefix("analytics/"), "analytics/");
  assert.equal(normalizeDestPrefix("analytics"), "analytics/");
});

test("computeMoveTarget moves a file into a folder", () => {
  assert.equal(
    computeMoveTarget({ key: "notes.md", isFolder: false }, "analytics/"),
    "analytics/notes.md"
  );
  assert.equal(
    computeMoveTarget({ key: "inbox/a.md", isFolder: false }, "dest/"),
    "dest/a.md"
  );
});

test("computeMoveTarget moves a file out to the library root", () => {
  assert.equal(
    computeMoveTarget({ key: "analytics/a.md", isFolder: false }, ""),
    "a.md"
  );
});

test("computeMoveTarget moves a file to a parent folder", () => {
  assert.equal(
    computeMoveTarget(
      { key: "verify/run/dest/a.md", isFolder: false },
      "verify/run/"
    ),
    "verify/run/a.md"
  );
});

test("computeMoveTarget rejects same-parent no-ops", () => {
  assert.equal(
    computeMoveTarget({ key: "notes.md", isFolder: false }, ""),
    null
  );
  assert.equal(
    computeMoveTarget({ key: "analytics/a.md", isFolder: false }, "analytics/"),
    null
  );
  assert.equal(
    computeMoveTarget({ key: "analytics/", isFolder: true }, ""),
    null
  );
});

test("computeMoveTarget rejects moving a folder into itself or a child", () => {
  assert.equal(
    computeMoveTarget({ key: "analytics/", isFolder: true }, "analytics/"),
    null
  );
  assert.equal(
    computeMoveTarget({ key: "analytics/", isFolder: true }, "analytics/nested/"),
    null
  );
  assert.equal(
    computeMoveTarget({ key: "analytics/", isFolder: true }, "reports/"),
    "reports/analytics/"
  );
});

test("isTreeMoveDrag is true only for the in-app MIME", () => {
  assert.equal(isTreeMoveDrag(["application/x-context101"]), true);
  assert.equal(isTreeMoveDrag(["Files"]), false);
  assert.equal(isTreeMoveDrag(["text/plain"]), false);
  assert.equal(isTreeMoveDrag([]), false);
});

test("parseDragPayload reads JSON and a plain key fallback", () => {
  assert.deepEqual(
    parseDragPayload(JSON.stringify({ key: "a.md", isFolder: false })),
    { key: "a.md", isFolder: false }
  );
  assert.deepEqual(parseDragPayload("analytics/a.md"), {
    key: "analytics/a.md",
    isFolder: false,
  });
  assert.deepEqual(parseDragPayload("analytics/"), {
    key: "analytics/",
    isFolder: true,
  });
  assert.equal(parseDragPayload(""), null);
  assert.equal(parseDragPayload("../secret"), null);
});
