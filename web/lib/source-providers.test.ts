import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ADD_SOURCE_MENU,
  isGoogleAddKind,
  PROVIDER_GROUPS,
} from "./source-providers";

test("add-source menu is files + one Google row + Notion + GitHub", () => {
  assert.deepEqual(
    ADD_SOURCE_MENU.map((item) => item.kind),
    ["files", "google", "notion", "github"]
  );
  assert.equal(
    ADD_SOURCE_MENU.some((item) => item.kind === "docs"),
    false
  );
  assert.equal(
    ADD_SOURCE_MENU.some((item) => item.kind === "sheets"),
    false
  );
  assert.equal(
    ADD_SOURCE_MENU.some((item) => item.kind === "slides"),
    false
  );
});

test("Knowledge sidebar still groups Google as docs / sheets / slides", () => {
  const google = PROVIDER_GROUPS.find((group) => group.id === "google");
  assert.deepEqual(google?.types, ["docs", "sheets", "slides"]);
  assert.equal(isGoogleAddKind("google"), true);
  assert.equal(isGoogleAddKind("docs"), true);
  assert.equal(isGoogleAddKind("notion"), false);
});
