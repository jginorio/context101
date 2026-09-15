import assert from "node:assert/strict";
import { test } from "node:test";

import { APP_NAV_ITEMS } from "./app-nav";

test("isolated conflicts nav includes Conflicts and omits Wiki", () => {
  const labels: string[] = APP_NAV_ITEMS.map((item) => item.label);
  const hrefs: string[] = APP_NAV_ITEMS.map((item) => item.href);
  assert.deepEqual(labels, [
    "Knowledge",
    "Suggestions",
    "Conflicts",
    "Sources",
    "Brains",
  ]);
  assert.equal(hrefs.includes("/wiki"), false);
});
