import assert from "node:assert/strict";
import { test } from "node:test";

import { parseApproveBody, parseProvenance, ParseError } from "./parse";

test("parseApproveBody rejects missing loserBody", () => {
  assert.throws(
    () =>
      parseApproveBody({
        id: "11111111-1111-1111-1111-111111111111",
        kind: "keep",
        winner: "left",
      }),
    (err: unknown) =>
      err instanceof ParseError && err.message === "loserBody is required"
  );
  assert.throws(
    () =>
      parseApproveBody({
        id: "11111111-1111-1111-1111-111111111111",
        resolution: { kind: "keep", winner: "right" },
      }),
    (err: unknown) =>
      err instanceof ParseError && err.message === "loserBody is required"
  );
});

test("parseApproveBody accepts keep with loserBody", () => {
  const parsed = parseApproveBody({
    id: "11111111-1111-1111-1111-111111111111",
    kind: "keep",
    winner: "left",
    loserBody: "# fixed\n",
  });
  assert.equal(parsed.resolution.kind, "keep");
  if (parsed.resolution.kind === "keep") {
    assert.equal(parsed.resolution.winner, "left");
    assert.equal(parsed.resolution.loserBody, "# fixed\n");
  }
});

test("parseProvenance drops wiki keys and github language !== markdown", () => {
  assert.equal(
    parseProvenance("wiki/overview.md", { metadataAttributes: { source: "wiki" } }),
    null
  );
  assert.equal(
    parseProvenance("wiki/code/acme.md", {
      metadataAttributes: { source: "code-wiki" },
    }),
    null
  );
  assert.equal(
    parseProvenance("sources/github/acme/src/x.ts.md", {
      metadataAttributes: {
        source: "github",
        language: "typescript",
        connector_id: "c1",
        repo: "acme/platform",
        path: "src/x.ts",
        commit_sha: "abc",
        branch: "main",
      },
    }),
    null
  );
  const md = parseProvenance("sources/github/acme/docs/a.md", {
    metadataAttributes: {
      source: "github",
      language: "markdown",
      connector_id: "c1",
      repo: "acme/platform",
      path: "docs/a.md",
      commit_sha: "abc",
      branch: "main",
    },
  });
  assert.equal(md?.kind, "github");
  if (md?.kind === "github") {
    assert.equal(md.repoPath, "docs/a.md");
  }
});
