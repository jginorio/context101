import assert from "node:assert/strict";
import { test } from "node:test";

import {
  authKindsFor,
  CONNECTOR_TYPES,
  githubHappyPathSteps,
  isConnectorType,
  matrixCell,
  SOURCE_PREFIXES,
  sidecarKeyFor,
  s3PrefixFor,
} from "./contract";

test("prefixes match the Knowledge source-providers map", () => {
  assert.equal(s3PrefixFor("docs"), "sources/docs/");
  assert.equal(s3PrefixFor("sheets"), "sources/sheets/");
  assert.equal(s3PrefixFor("slides"), "sources/slides/");
  assert.equal(s3PrefixFor("notion"), "sources/notion/");
  assert.equal(s3PrefixFor("github"), "sources/github/");
  assert.deepEqual(
    CONNECTOR_TYPES.map((type) => SOURCE_PREFIXES[type]),
    [
      "sources/docs/",
      "sources/sheets/",
      "sources/slides/",
      "sources/notion/",
      "sources/github/",
    ]
  );
});

test("sidecar sits next to the markdown object", () => {
  assert.equal(
    sidecarKeyFor("sources/github/acme-fixture/docs/canary.md"),
    "sources/github/acme-fixture/docs/canary.md.metadata.json"
  );
});

test("auth kinds match the live Lambdas", () => {
  assert.deepEqual(authKindsFor("docs"), ["google_oauth_refresh_token"]);
  assert.deepEqual(authKindsFor("notion"), ["notion_oauth_access_token"]);
  assert.deepEqual(authKindsFor("github"), ["github_app", "github_pat"]);
});

test("isConnectorType rejects files, google picker kind, and unknown", () => {
  assert.equal(isConnectorType("github"), true);
  assert.equal(isConnectorType("files"), false);
  assert.equal(isConnectorType("google"), false);
  assert.equal(isConnectorType("wiki"), false);
});

test("matrix happy/update/delete/bad-token exist for every type", () => {
  for (const type of CONNECTOR_TYPES) {
    for (const row of ["happy", "update", "delete", "bad-token"] as const) {
      const cell = matrixCell(type, row);
      assert.equal(cell.type, type);
      assert.equal(cell.row, row);
      assert.ok(cell.steps.length >= 2);
      assert.ok(cell.doneWhen.includes("retrieve"));
    }
  }
});

test("github live e2e is skipped without VERIFY_CONNECTOR_MATRIX", (t) => {
  if (process.env.VERIFY_CONNECTOR_MATRIX === "1") {
    assert.ok(
      process.env.VERIFY_GITHUB_REPO,
      "live github/happy needs VERIFY_GITHUB_REPO (PAT stays in env, never asserted as text)"
    );
    assert.ok(
      process.env.VERIFY_GITHUB_PAT,
      "live github/happy needs VERIFY_GITHUB_PAT in the environment"
    );
    return;
  }
  t.skip("set VERIFY_CONNECTOR_MATRIX=1 for live github/happy (bin/connector-matrix --live)");
});

test("github happy path is the library-ingest retrieve template", () => {
  const steps = githubHappyPathSteps();
  const ids = steps.map((s) => s.id);
  assert.deepEqual(ids, [
    "connect",
    "s3",
    "retrieve-create",
    "update",
    "delete",
  ]);
  const retrieveCreate = steps.find((s) => s.id === "retrieve-create");
  assert.match(retrieveCreate?.action ?? "", /bin\/retrieve --expect-key/);
  assert.match(retrieveCreate?.action ?? "", /--canary/);
  assert.match(retrieveCreate?.proof ?? "", /library-ingest create/);
  const del = steps.find((s) => s.id === "delete");
  assert.match(del?.action ?? "", /\/api\/connectors\/delete/);
  assert.match(del?.proof ?? "", /--absent-key/);
  assert.match(del?.proof ?? "", /library-ingest delete/);
});
