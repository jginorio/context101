import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decryptGoogleSession,
  encryptGoogleSession,
  GOOGLE_SESSION_COOKIE,
} from "./google-session";

test("google session cookie name is httpOnly-path friendly", () => {
  assert.equal(GOOGLE_SESSION_COOKIE, "ctx_google_session");
});

test("encrypt / decrypt round-trips refresh token and email", () => {
  const token = encryptGoogleSession({
    refresh_token: "1//refresh-token-value",
    email: "jaime@example.com",
  });
  assert.notEqual(token, "1//refresh-token-value");
  assert.equal(token.includes("refresh-token-value"), false);
  assert.deepEqual(decryptGoogleSession(token), {
    refresh_token: "1//refresh-token-value",
    email: "jaime@example.com",
  });
});

test("decrypt rejects missing, truncated, or tampered cookies", () => {
  assert.equal(decryptGoogleSession(""), null);
  assert.equal(decryptGoogleSession("not-a-cookie"), null);
  const token = encryptGoogleSession({ refresh_token: "abc" });
  const [iv, data] = token.split(".");
  assert.equal(decryptGoogleSession(`${iv}.${data.slice(0, -2)}aa`), null);
});
