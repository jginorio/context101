import assert from "node:assert/strict";
import { test } from "node:test";

import { hasVisibleLibraryEntries } from "./knowledge-library";

test("hasVisibleLibraryEntries is false when only hidden roots exist", () => {
  assert.equal(
    hasVisibleLibraryEntries({
      folders: [{ name: "sources" }, { name: "wiki" }],
      files: [],
    }),
    false
  );
  assert.equal(hasVisibleLibraryEntries({ folders: [], files: [] }), false);
});

test("hasVisibleLibraryEntries is true for a root file or user folder", () => {
  assert.equal(
    hasVisibleLibraryEntries({
      folders: [{ name: "sources" }],
      files: [{ name: "notes.md" }],
    }),
    true
  );
  assert.equal(
    hasVisibleLibraryEntries({
      folders: [{ name: "sources" }, { name: "handbook" }],
      files: [],
    }),
    true
  );
});
