import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  DEFAULT_SPACE,
  discoverLegacyEnv,
  listSpaces,
  matchSpaces,
  namePrefixForSpace,
  parseSpaceName,
  stackNameForSpace,
} from "../src/spaces.js";
import { makeRepoFixture, writeTestDeployEnv } from "./helpers.js";

test("parseSpaceName accepts platea and rejects junk", () => {
  assert.equal(parseSpaceName("platea"), "platea");
  assert.equal(parseSpaceName("Findit"), "findit");
  assert.throws(() => parseSpaceName("has_underscore"), /lowercase|hyphen/);
  assert.throws(() => parseSpaceName("1bad"), /lowercase|letter/);
});

test("default space keeps the live stack id and prefix", () => {
  assert.equal(stackNameForSpace(DEFAULT_SPACE), "Context101Stack");
  assert.equal(namePrefixForSpace(DEFAULT_SPACE), "context101");
  assert.equal(stackNameForSpace("platea"), "Context101Platea");
  assert.equal(namePrefixForSpace("platea"), "context101-platea");
});

test("legacy cdk/.deploy-env becomes the default space without orphaning", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-legacy-"));
  await makeRepoFixture(cwd);
  await writeTestDeployEnv(cwd);
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-legacy-home-"));
  const found = discoverLegacyEnv({ homeDir: home, cwd });
  assert.equal(found, path.join(cwd, "cdk", ".deploy-env"));
  const spaces = listSpaces({ homeDir: home, cwd });
  assert.equal(spaces.length, 1);
  assert.equal(spaces[0].name, DEFAULT_SPACE);
  assert.equal(spaces[0].envPath, found);
  assert.equal(spaces[0].stackName, "Context101Stack");
});

test("matchSpaces picks one space and requires a name when several exist", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-spaces-"));
  for (const name of ["findit", "platea"]) {
    const dir = path.join(home, ".context101", "spaces", name);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "deploy-env"),
      'CTX_TOKEN="ctx_testtoken_xx"\nSTACK_NAME="Context101Findit"\n',
      { mode: 0o600 }
    );
  }
  await writeFile(
    path.join(home, ".context101", "spaces", "platea", "deploy-env"),
    'CTX_TOKEN="ctx_testtoken_xx"\nSTACK_NAME="Context101Platea"\n',
    { mode: 0o600 }
  );
  const many = matchSpaces({}, { homeDir: home });
  assert.equal(many.needPick, true);
  assert.equal(many.space, null);
  const named = matchSpaces({ space: "platea" }, { homeDir: home });
  assert.equal(named.space.name, "platea");
  const byStack = matchSpaces({ space: "Context101Platea" }, { homeDir: home });
  assert.equal(byStack.space.name, "platea");
});

test("legacy default stays visible when another named space exists", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-overlay-"));
  await makeRepoFixture(cwd);
  await writeTestDeployEnv(cwd);
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-overlay-home-"));
  const dir = path.join(home, ".context101", "spaces", "platea");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "deploy-env"),
    'CTX_TOKEN="ctx_testtoken_xx"\nSTACK_NAME="Context101Platea"\n',
    { mode: 0o600 }
  );
  const spaces = listSpaces({ homeDir: home, cwd });
  assert.deepEqual(
    spaces.map((space) => space.name),
    ["default", "platea"]
  );
  assert.equal(spaces[0].envPath, path.join(cwd, "cdk", ".deploy-env"));
});

test("several spaces in a non-TTY require a name", async () => {
  const { resolveSelectedSpace } = await import("../src/spaces.js");
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-pick-"));
  for (const name of ["findit", "platea"]) {
    const dir = path.join(home, ".context101", "spaces", name);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "deploy-env"), `STACK_NAME="Context101${name}"\n`, {
      mode: 0o600,
    });
  }
  await assert.rejects(
    () => resolveSelectedSpace({}, { homeDir: home }),
    /several spaces/
  );
});
