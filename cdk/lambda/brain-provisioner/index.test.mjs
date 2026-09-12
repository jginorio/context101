import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isConflict,
  isNotFound,
  nextBedrockDeleteAction,
  withConflictRetry,
} from "./teardown-helpers.mjs";

test("isConflict recognizes Bedrock ConflictException", () => {
  assert.equal(isConflict({ name: "ConflictException" }), true);
  assert.equal(isConflict({ Code: "ConflictException" }), true);
  assert.equal(isConflict({ name: "ResourceNotFoundException" }), false);
  assert.equal(isConflict(null), false);
});

test("isNotFound covers the teardown miss shapes", () => {
  assert.equal(isNotFound({ name: "NoSuchBucket" }), true);
  assert.equal(isNotFound({ name: "ResourceNotFoundException" }), true);
  assert.equal(isNotFound({ name: "NotFoundException" }), true);
  assert.equal(isNotFound({ name: "NotFound" }), true);
  assert.equal(isNotFound({ name: "ConflictException" }), false);
});

test("withConflictRetry succeeds after transient ConflictException", async () => {
  let calls = 0;
  const result = await withConflictRetry(
    async () => {
      calls += 1;
      if (calls < 3) {
        const err = new Error("already in use");
        err.name = "ConflictException";
        throw err;
      }
      return "deleted";
    },
    { attempts: 5, delayMs: 1 }
  );
  assert.equal(result, "deleted");
  assert.equal(calls, 3);
});

test("withConflictRetry rethrows non-conflict errors immediately", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withConflictRetry(
        async () => {
          calls += 1;
          const err = new Error("boom");
          err.name = "AccessDenied";
          throw err;
        },
        { attempts: 5, delayMs: 1 }
      ),
    /boom/
  );
  assert.equal(calls, 1);
});

test("nextBedrockDeleteAction drives RETAIN recovery for DELETE_UNSUCCESSFUL", () => {
  assert.equal(nextBedrockDeleteAction(undefined), "gone");
  assert.equal(nextBedrockDeleteAction("DELETING"), "wait");
  assert.equal(nextBedrockDeleteAction("DELETE_UNSUCCESSFUL"), "retain");
  assert.equal(
    nextBedrockDeleteAction("DELETE_UNSUCCESSFUL", { retained: true }),
    "retry"
  );
  assert.equal(nextBedrockDeleteAction("AVAILABLE"), "retry");
});

test("withConflictRetry exhausts attempts on persistent conflict", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withConflictRetry(
        async () => {
          calls += 1;
          const err = new Error("already in use");
          err.name = "ConflictException";
          throw err;
        },
        { attempts: 3, delayMs: 1 }
      ),
    /already in use/
  );
  assert.equal(calls, 3);
});
