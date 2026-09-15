import assert from "node:assert/strict";
import { test } from "node:test";

import {
  extraTrustedOrigins,
  rewriteMagicLinkUrl,
  shouldSendMagicLink,
} from "./magic-link";

test("rewrites the Better Auth verify URL onto APP_URL and keeps the token", () => {
  const pluginUrl =
    "https://main.d123.amplifyapp.com/api/auth/magic-link/verify?token=abc123&callbackURL=%2Fknowledge";
  const rewritten = rewriteMagicLinkUrl(
    pluginUrl,
    "https://app.example.test"
  );
  const url = new URL(rewritten);
  assert.equal(url.origin, "https://app.example.test");
  assert.equal(url.pathname, "/api/auth/magic-link/verify");
  assert.equal(url.searchParams.get("token"), "abc123");
  assert.equal(url.searchParams.get("callbackURL"), "/knowledge");
});

test("rewrite is a no-op when APP_URL already matches the plugin origin", () => {
  const pluginUrl =
    "https://app.example.test/api/auth/magic-link/verify?token=xyz";
  assert.equal(
    rewriteMagicLinkUrl(pluginUrl, "https://app.example.test/"),
    pluginUrl
  );
});

test("sends for existing users even when public signup is disabled", () => {
  assert.equal(
    shouldSendMagicLink({ allowPublicSignup: false, userExists: true }),
    true
  );
});

test("skips unknown emails when public signup is disabled", () => {
  assert.equal(
    shouldSendMagicLink({ allowPublicSignup: false, userExists: false }),
    false
  );
});

test("sends for unknown emails when public signup is enabled", () => {
  assert.equal(
    shouldSendMagicLink({ allowPublicSignup: true, userExists: false }),
    true
  );
});

test("trusts APP_URL origin so the rewritten verify link is accepted", () => {
  assert.deepEqual(extraTrustedOrigins("https://app.example.test/"), [
    "https://app.example.test",
  ]);
  assert.deepEqual(extraTrustedOrigins(undefined), []);
  assert.deepEqual(extraTrustedOrigins("not a url"), []);
});
