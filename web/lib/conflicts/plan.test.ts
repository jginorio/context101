import assert from "node:assert/strict";
import { test } from "node:test";

import { planWrites } from "./plan";
import type { PendingConflict, Provenance } from "./types";
import { ConflictFailure } from "./types";

function manual(key: string): Provenance {
  return { kind: "manual", key };
}

function notion(key: string): Provenance {
  return { kind: "notion", key, connectorId: "c1", pageId: "p1" };
}

function pending(
  left: Provenance,
  right: Provenance
): PendingConflict {
  return {
    status: "pending",
    id: "11111111-1111-1111-1111-111111111111",
    orgId: "org",
    brainId: "brain",
    fingerprint: "fp",
    topic: "session ttl",
    title: "Session TTL disagrees",
    rationale: "12h vs 24h",
    left: {
      provenance: left,
      claim: { topic: "session ttl", text: "12 hours", excerpt: "12 hours" },
      canonicalHash: "h1",
    },
    right: {
      provenance: right,
      claim: { topic: "session ttl", text: "24 hours", excerpt: "24 hours" },
      canonicalHash: "h2",
    },
    proposedLoserBody: { left: "TTL is 24 hours", right: "TTL is 12 hours" },
    occurrenceCount: 1,
    lastDetectedVia: "query",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastError: null,
  };
}

test("planWrites keep writes only the loser body", () => {
  const targets = planWrites(pending(manual("a.md"), manual("b.md")), {
    kind: "keep",
    winner: "left",
    loserBody: "TTL is 12 hours.\n",
  });
  assert.deepEqual(targets, [
    {
      side: "right",
      provenance: { kind: "manual", key: "b.md" },
      body: "TTL is 12 hours.\n",
    },
  ]);
});

test("planWrites rejects a Notion or Google loser", () => {
  assert.throws(
    () =>
      planWrites(pending(manual("a.md"), notion("b.md")), {
        kind: "keep",
        winner: "left",
        loserBody: "aligned\n",
      }),
    (err: unknown) =>
      err instanceof ConflictFailure &&
      err.fail.kind === "unwritable-loser" &&
      err.fail.provenanceKind === "notion"
  );
  const google: Provenance = {
    kind: "google",
    key: "c.md",
    connectorId: "c1",
    sourceType: "docs",
  };
  assert.throws(
    () =>
      planWrites(pending(manual("a.md"), google), {
        kind: "keep",
        winner: "left",
        loserBody: "aligned\n",
      }),
    (err: unknown) =>
      err instanceof ConflictFailure &&
      err.fail.kind === "unwritable-loser" &&
      err.fail.provenanceKind === "google"
  );
});
