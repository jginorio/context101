import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  cacheStackRoot,
  embeddedStackRoot,
  monorepoStackRoot,
  resolveStackRoot,
} from "../src/stack-source.js";
import { makePackedStackFixture, makeRepoFixture } from "./helpers.js";

test("HOME leftover ~/context101 does not beat the packaged stack", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-home-clone-"));
  const leftover = path.join(home, "context101");
  await makeRepoFixture(leftover);

  const pkg = await mkdtemp(path.join(tmpdir(), "ctx101-pkg-"));
  const packed = path.join(pkg, "stack");
  await mkdir(packed, { recursive: true });
  await makePackedStackFixture(packed);

  const fromHome = resolveStackRoot({
    cwd: home,
    homeDir: home,
    packageDir: pkg,
    env: {},
  });
  assert.equal(fromHome, packed);
  assert.notEqual(fromHome, leftover);

  const fromClone = resolveStackRoot({
    cwd: leftover,
    homeDir: home,
    packageDir: pkg,
    env: {},
  });
  assert.equal(fromClone, packed);
  assert.notEqual(fromClone, leftover);
});

test("CONTEXT101_STACK_ROOT wins over packaged stack and leftover clone", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-env-home-"));
  const leftover = path.join(home, "context101");
  await makeRepoFixture(leftover);

  const pkg = await mkdtemp(path.join(tmpdir(), "ctx101-env-pkg-"));
  const packed = path.join(pkg, "stack");
  await mkdir(packed, { recursive: true });
  await makePackedStackFixture(packed);

  const forced = await mkdtemp(path.join(tmpdir(), "ctx101-forced-"));
  await makePackedStackFixture(forced);

  const resolved = resolveStackRoot({
    cwd: leftover,
    homeDir: home,
    packageDir: pkg,
    env: { CONTEXT101_STACK_ROOT: forced },
  });
  assert.equal(resolved, forced);
});

test("explicit stackRoot wins over CONTEXT101_STACK_ROOT", async () => {
  const forced = await mkdtemp(path.join(tmpdir(), "ctx101-forced-explicit-"));
  await makePackedStackFixture(forced);
  const explicit = await mkdtemp(path.join(tmpdir(), "ctx101-explicit-"));
  await makePackedStackFixture(explicit);

  const resolved = resolveStackRoot({
    stackRoot: explicit,
    env: { CONTEXT101_STACK_ROOT: forced },
    homeDir: await mkdtemp(path.join(tmpdir(), "ctx101-explicit-home-")),
    packageDir: await mkdtemp(path.join(tmpdir(), "ctx101-explicit-pkg-")),
  });
  assert.equal(resolved, explicit);
});

test("version cache beats a monorepo walk when no packaged stack exists", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-cache-home-"));
  const version = "0.1.10";
  const cached = path.join(home, ".cache", "context101", version);
  await mkdir(cached, { recursive: true });
  await makePackedStackFixture(cached);

  const pkg = await mkdtemp(path.join(tmpdir(), "ctx101-cache-pkg-"));
  const resolved = resolveStackRoot({
    cwd: home,
    homeDir: home,
    packageDir: pkg,
    version,
    env: {},
  });
  assert.equal(resolved, cached);
  assert.equal(cacheStackRoot(version, home), cached);
});

test("monorepo checkout is the last resort when developing the CLI", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-mono-home-"));
  const leftover = path.join(home, "context101");
  await makeRepoFixture(leftover);

  const resolved = resolveStackRoot({
    cwd: leftover,
    homeDir: home,
    env: {},
  });
  assert.equal(resolved, monorepoStackRoot());
  assert.notEqual(resolved, leftover);
  assert.equal(embeddedStackRoot(), null);
});

test("pack-stack ships cdk lockfile and not the web app", async () => {
  const src = await readFile(fileURLToPath(new URL("../scripts/pack-stack.js", import.meta.url)), "utf8");
  assert.match(src, /copyRel\("cdk"\)/);
  assert.match(src, /cdk\/package-lock\.json/);
  assert.equal(src.includes('copyRel("web")'), false);
  assert.equal(src.includes('copyRel("package-lock.json")'), false);
  assert.equal(src.includes('copyRel("web/package.json")'), false);

  const cdkLock = fileURLToPath(new URL("../../../cdk/package-lock.json", import.meta.url));
  const lock = JSON.parse(await readFile(cdkLock, "utf8"));
  assert.equal(lock.name, "context101-cdk");
});
