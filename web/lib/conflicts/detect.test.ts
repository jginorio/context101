import assert from "node:assert/strict";
import { test } from "node:test";

import { pairContradictions, type LoadedDoc } from "./detect";
import { provenanceId } from "./fingerprint";
import type { Provenance } from "./types";

function doc(key: string, body: string, provenance: Provenance): LoadedDoc {
  return {
    key,
    body,
    provenance,
    canonicalHash: `hash:${key}`,
  };
}

test("pairContradictions fingerprints with the injected judge", async () => {
  const leftP: Provenance = { kind: "manual", key: "policies/a.md" };
  const rightP: Provenance = { kind: "manual", key: "policies/b.md" };
  const docs = [
    doc("policies/a.md", "TTL is 12 hours", leftP),
    doc("policies/b.md", "TTL is 24 hours", rightP),
  ];
  const pairs = await pairContradictions(
    docs,
    {
      async findContradictions() {
        return [
          {
            topic: "session ttl",
            title: "Session TTL disagrees",
            rationale: "12h vs 24h",
            left: {
              provenance: leftP,
              claim: { topic: "session ttl", text: "12 hours", excerpt: "12 hours" },
              canonicalHash: "hash:policies/a.md",
            },
            right: {
              provenance: rightP,
              claim: { topic: "session ttl", text: "24 hours", excerpt: "24 hours" },
              canonicalHash: "hash:policies/b.md",
            },
            proposedLoserBody: { left: "TTL is 24 hours", right: "TTL is 12 hours" },
          },
        ];
      },
    },
    { orgId: "org", brainId: "brain" }
  );
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].fingerprint.length, 64);
  assert.equal(
    provenanceId(pairs[0].left.provenance),
    "s3:policies/a.md"
  );
});
