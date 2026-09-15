import assert from "node:assert/strict";
import { test } from "node:test";

import { magicLinkEmail } from "./templates";

test("magic link email includes the one-click URL in html and text", () => {
  const magicUrl =
    "https://app.example.test/api/auth/magic-link/verify?token=abc&callbackURL=%2Fknowledge";
  const content = magicLinkEmail({ magicUrl });

  assert.equal(content.subject, "Sign in to Context101");
  assert.match(content.html, /Sign in to Context101/);
  assert.match(content.html, /Sign in/);
  assert.match(
    content.html,
    /https:\/\/app\.example\.test\/api\/auth\/magic-link\/verify\?token=abc/
  );
  assert.match(content.text, /Sign in to Context101/);
  assert.equal(content.text.includes(magicUrl), true);
  assert.match(content.text, /If you did not request this/);
});
