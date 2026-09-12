import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  detectGitRemote,
  findRepoRoot,
  normalizeRepoUrl,
  readHardcodedRepo,
} from "../src/repo.js";
import { makeRepoFixture } from "./helpers.js";

test("findRepoRoot wants cdk/deploy.sh and web/, not site/", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-root-"));
  await makeRepoFixture(root);
  assert.equal(findRepoRoot(path.join(root, "web")), root);
  assert.equal(findRepoRoot(tmpdir()), null);
});

test("normalizes ssh remotes", () => {
  assert.equal(
    normalizeRepoUrl("git@github.com:acme/context101.git"),
    "https://github.com/acme/context101"
  );
});

test("reads the hardcoded Amplify repo from the stack source", () => {
  assert.equal(
    readHardcodedRepo('repository: "https://github.com/jginorio/context101",'),
    "https://github.com/jginorio/context101"
  );
});

test("detectGitRemote uses origin", () => {
  const url = detectGitRemote(
    () => ({
      ok: true,
      stdout: "git@github.com:acme/context101.git\n",
      stderr: "",
      code: 0,
    }),
    "/tmp"
  );
  assert.equal(url, "https://github.com/acme/context101");
});
