import assert from "node:assert/strict";
import { test } from "node:test";

import { APP_NAV_ITEMS } from "./app-nav";

test("shipping nav is Knowledge / Suggestions / Sources / Brains", () => {
  assert.deepEqual(
    APP_NAV_ITEMS.map((item) => item.label),
    ["Knowledge", "Suggestions", "Sources", "Brains"]
  );
});

test("shipping nav has no Wiki or Conflicts", () => {
  const labels: string[] = APP_NAV_ITEMS.map((item) => item.label);
  const hrefs: string[] = APP_NAV_ITEMS.map((item) => item.href);
  assert.equal(labels.includes("Wiki"), false);
  assert.equal(labels.includes("Conflicts"), false);
  assert.equal(hrefs.includes("/wiki"), false);
  assert.equal(hrefs.includes("/conflicts"), false);
});
