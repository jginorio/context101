import assert from "node:assert/strict";
import { test } from "node:test";

import {
  APP_NAV_ITEMS,
  WIKI_SETTINGS_HREF,
  WIKI_UI_ENABLED,
  visibleAppNavItems,
} from "./wiki-ui";

test("wiki UI is off by default", () => {
  assert.equal(WIKI_UI_ENABLED, false);
});

test("nav catalog still lists Wiki so flipping the flag restores it", () => {
  const wiki = APP_NAV_ITEMS.find((item) => item.href === "/wiki");
  assert.ok(wiki);
  assert.equal(wiki?.label, "Wiki");
  assert.equal(wiki?.wiki, true);
});

test("visible nav omits Wiki while UI is off", () => {
  const labels = visibleAppNavItems(false).map((item) => item.label);
  assert.deepEqual(labels, [
    "Knowledge",
    "Suggestions",
    "Conflicts",
    "Sources",
    "Brains",
  ]);
});

test("visible nav includes Wiki when UI is on", () => {
  const labels = visibleAppNavItems(true).map((item) => item.label);
  assert.deepEqual(labels, [
    "Knowledge",
    "Wiki",
    "Suggestions",
    "Conflicts",
    "Sources",
    "Brains",
  ]);
});

test("product default visible nav matches the off flag", () => {
  assert.equal(
    visibleAppNavItems().some((item) => item.label === "Wiki"),
    WIKI_UI_ENABLED
  );
});

test("wiki settings live under the wiki surface, not Settings → Advanced", () => {
  assert.equal(WIKI_SETTINGS_HREF, "/wiki/settings");
  assert.equal(WIKI_SETTINGS_HREF.startsWith("/wiki/"), true);
  assert.equal(WIKI_SETTINGS_HREF.startsWith("/settings"), false);
});
