import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizeConnectorError } from "./connector-error-summary";

const NOTION_401 =
  'notion /pages/1378955d9f5f8059a978cd2cefa349401 401: {"object":"error","status":401,"code":"unauthorized","message":"API token is invalid.","request_id":"38dc65e0-863d-4746-89777-5e2dfb9f558a"}';

const GOOGLE_401 =
  'documents.get failed 401: {"error":{"code":401,"message":"Request had invalid authentication credentials.","status":"UNAUTHENTICATED"}}';

test("summarizes Notion 401 JSON as status + code + message", () => {
  assert.equal(
    summarizeConnectorError(NOTION_401),
    "401 unauthorized — API token is invalid."
  );
});

test("unwraps nested Google error objects", () => {
  assert.equal(
    summarizeConnectorError(GOOGLE_401),
    "401 UNAUTHENTICATED — Request had invalid authentication credentials."
  );
});

test("recovers a message from truncated JSON", () => {
  assert.equal(
    summarizeConnectorError(
      'notion /pages/abc 401: {"object":"error","status":401,"code":"unauthorized","message":"API token is invalid.","request_id":"cut-off'
    ),
    "401 unauthorized — API token is invalid."
  );
});

test("keeps short plain errors intact", () => {
  assert.equal(
    summarizeConnectorError("connector xyz not found"),
    "connector xyz not found"
  );
});

test("empty input falls back to Sync failed", () => {
  assert.equal(summarizeConnectorError("   "), "Sync failed");
});
