import assert from "node:assert/strict";
import { test } from "node:test";

import { decideEnqueue, decideHashWatch } from "./enqueue-policy";

test("enqueue: two reports of the same pair bump occurrence", () => {
  const incoming = { left: "h1", right: "h2" };
  const first = decideEnqueue({ incoming, open: null, pin: null });
  assert.deepEqual(first, { kind: "insert" });
  const second = decideEnqueue({
    incoming,
    open: { id: "c1", hashes: incoming },
    pin: null,
  });
  assert.deepEqual(second, { kind: "bump", id: "c1" });
});

test("pin skip: same hashes after reject are skipped", () => {
  const incoming = { left: "h1", right: "h2" };
  const decision = decideEnqueue({
    incoming,
    open: null,
    pin: { hashes: incoming },
  });
  assert.deepEqual(decision, { kind: "skip", reason: "pinned-unchanged" });
});

test("closed pair with moved hashes inserts a new pending row", () => {
  const decision = decideEnqueue({
    incoming: { left: "h3", right: "h4" },
    open: null,
    pin: { hashes: { left: "h1", right: "h2" } },
  });
  assert.deepEqual(decision, { kind: "insert" });
});

test("hash watch skips an unchanged trigger body", () => {
  assert.equal(
    decideHashWatch({ storedHash: "abc", incomingHash: "abc" }),
    "skip"
  );
  assert.equal(
    decideHashWatch({ storedHash: "abc", incomingHash: "def" }),
    "continue"
  );
});
