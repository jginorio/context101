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

test("findRepoRoot wants cdk/ + web/ + lockfile, not site/", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-root-"));
  await makeRepoFixture(root);
  assert.equal(findRepoRoot(path.join(root, "web")), root);
  assert.equal(findRepoRoot(tmpdir()), null);
});

test("findRepoRoot rejects a checkout without a root lockfile", async () => {
  const { unlink } = await import("node:fs/promises");
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-nolock-"));
  await makeRepoFixture(root);
  await unlink(path.join(root, "package-lock.json"));
  assert.equal(findRepoRoot(root), null);
});

test("normalizes ssh remotes", () => {
  assert.equal(
    normalizeRepoUrl("git@github.com:acme/context101.git"),
    "https://github.com/acme/context101"
  );
});

test("strips credentials from https remotes", () => {
  assert.equal(
    normalizeRepoUrl("https://user:pass@github.com/acme/context101.git"),
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
