import assert from "node:assert/strict";
import { test } from "node:test";

import { APP_NAV_ITEMS, WIKI_SETTINGS_HREF } from "./app-nav";

test("isolated wiki nav includes Wiki and omits Conflicts", () => {
  const labels: string[] = APP_NAV_ITEMS.map((item) => item.label);
  const hrefs: string[] = APP_NAV_ITEMS.map((item) => item.href);
  assert.deepEqual(labels, [
    "Knowledge",
    "Wiki",
    "Suggestions",
    "Sources",
    "Brains",
  ]);
  assert.equal(hrefs.includes("/conflicts"), false);
  assert.equal(WIKI_SETTINGS_HREF, "/wiki/settings");
});
