import assert from "node:assert/strict";
import { test } from "node:test";

import { renderMarkdown } from "../github-doc-format";
import { canonicalHash, fingerprintOf, provenanceId } from "./fingerprint";
import type { Provenance } from "./types";

function github(key: string, repoPath: string): Provenance {
  return {
    kind: "github",
    key,
    connectorId: "conn-1",
    repo: "acme/platform",
    repoPath,
    branch: "main",
    blobSha: "abc",
    language: "markdown",
  };
}

test("fingerprint is order-independent", () => {
  const a = provenanceId(github("sources/github/acme/a.md", "docs/a.md"));
  const b = provenanceId(github("sources/github/acme/b.md", "docs/b.md"));
  assert.equal(
    fingerprintOf("org", "brain", "session ttl", a, b),
    fingerprintOf("org", "brain", "session ttl", b, a)
  );
});

test("fingerprint changes with topic or provenance id, not S3 key", () => {
  const left = github("sources/github/acme/a.md", "docs/a.md");
  const leftMoved = github("sources/github/acme/renamed.md", "docs/a.md");
  const right = github("sources/github/acme/b.md", "docs/b.md");
  const base = fingerprintOf(
    "org",
    "brain",
    "session ttl",
    provenanceId(left),
    provenanceId(right)
  );
  assert.equal(
    fingerprintOf(
      "org",
      "brain",
      "session ttl",
      provenanceId(leftMoved),
      provenanceId(right)
    ),
    base
  );
  assert.notEqual(
    fingerprintOf(
      "org",
      "brain",
      "auth cookie",
      provenanceId(left),
      provenanceId(right)
    ),
    base
  );
  const otherPath = github("sources/github/acme/a.md", "docs/other.md");
  assert.notEqual(
    fingerprintOf(
      "org",
      "brain",
      "session ttl",
      provenanceId(otherPath),
      provenanceId(right)
    ),
    base
  );
});

test("canonical hash ignores last-synced citation header", () => {
  const body = "Cookies last 12 hours.";
  const a = renderMarkdown(body, {
    path: "docs/auth.md",
    repoFullName: "acme/platform",
    htmlUrl: "https://github.com/acme/platform/blob/main/docs/auth.md",
    now: "2026-01-01T00:00:00.000Z",
  });
  const b = renderMarkdown(body, {
    path: "docs/auth.md",
    repoFullName: "acme/platform",
    htmlUrl: "https://github.com/acme/platform/blob/main/docs/auth.md",
    now: "2026-09-12T05:00:00.000Z",
  });
  assert.equal(canonicalHash(a), canonicalHash(b));
  assert.equal(canonicalHash(a), canonicalHash(body));
});
