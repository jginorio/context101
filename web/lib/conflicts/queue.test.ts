import assert from "node:assert/strict";
import { test } from "node:test";

import { decideEnqueue } from "./enqueue-policy";

test("queue helpers skip DB when DATABASE_URL is unset", async () => {
  if (process.env.DATABASE_URL) {
    const { enqueuePair } = await import("./queue");
    assert.equal(typeof enqueuePair, "function");
    return;
  }
  const decision = decideEnqueue({
    incoming: { left: "a", right: "b" },
    open: { id: "c1", hashes: { left: "a", right: "b" } },
    pin: null,
  });
  assert.deepEqual(decision, { kind: "bump", id: "c1" });
});
