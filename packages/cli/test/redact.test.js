import assert from "node:assert/strict";
import { test } from "node:test";
import { assertNoSecrets, mask, outputContainsSecret } from "../src/redact.js";

test("mask never returns the raw secret", () => {
  const secret = "abcdefghijklmnopqrstuvwxyz012345";
  const shown = mask(secret);
  assert.equal(shown.includes(secret), false);
  assert.match(shown, /…/);
});

test("assertNoSecrets throws when a value leaks", () => {
  assert.throws(
    () => assertNoSecrets("hello SECRET_VALUE world", ["SECRET_VALUE"]),
    /leaked a secret/
  );
  assert.equal(outputContainsSecret("ok", ["SECRET_VALUE"]), false);
});
