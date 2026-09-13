import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  cacheStackRoot,
  cdkOutputDir,
  embeddedStackRoot,
  ensureStackRoot,
  isPublishedPackageStack,
  monorepoStackRoot,
  resolveStackRoot,
  resolveStackSource,
  writableCacheDest,
} from "../src/stack-source.js";
import { makePackedStackFixture, makeRepoFixture } from "./helpers.js";

const VERSION = "0.1.15";

test("HOME leftover ~/context101 does not beat the packaged stack", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-home-clone-"));
  const leftover = path.join(home, "context101");
  await makeRepoFixture(leftover);

  const pkg = await mkdtemp(path.join(tmpdir(), "ctx101-pkg-"));
  const packed = path.join(pkg, "stack");
  await mkdir(packed, { recursive: true });
  await makePackedStackFixture(packed);

  const fromHome = resolveStackSource({
    cwd: home,
    homeDir: home,
    packageDir: pkg,
    env: {},
  });
  assert.equal(fromHome, packed);
  assert.notEqual(fromHome, leftover);

  const fromClone = resolveStackSource({
    cwd: leftover,
    homeDir: home,
    packageDir: pkg,
    env: {},
  });
  assert.equal(fromClone, packed);
  assert.notEqual(fromClone, leftover);

  const writableHome = resolveStackRoot({
    cwd: home,
    homeDir: home,
    packageDir: pkg,
    version: VERSION,
    env: {},
  });
  assert.notEqual(writableHome, leftover);
  assert.notEqual(writableHome, packed);
});

test("resolve/ensure never use the published package as a writable out dir", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-pub-home-"));
  const leftover = path.join(home, "context101");
  await makeRepoFixture(leftover);

  const npmRoot = path.join(home, "nvm", "lib", "node_modules", "context101-cli");
  const packed = path.join(npmRoot, "stack");
  await mkdir(packed, { recursive: true });
  await makePackedStackFixture(packed);

  const resolved = resolveStackRoot({
    cwd: leftover,
    homeDir: home,
    packageDir: npmRoot,
    version: VERSION,
    env: {},
  });
  assert.equal(resolved, null);
  assert.equal(isPublishedPackageStack(packed, npmRoot), true);
  assert.equal(isPublishedPackageStack(leftover, npmRoot), false);

  const ensured = await ensureStackRoot({
    cwd: leftover,
    homeDir: home,
    packageDir: npmRoot,
    version: VERSION,
    env: {},
  });
  const cache = writableCacheDest(VERSION, home);
  assert.equal(ensured.ok, true);
  assert.equal(ensured.stackRoot, cache);
  assert.notEqual(ensured.stackRoot, packed);
  assert.notEqual(ensured.stackRoot, leftover);
  assert.equal(ensured.stackRoot.includes(`${path.sep}node_modules${path.sep}context101-cli`), false);
  assert.equal(existsSync(path.join(cache, "cdk", "cdk.json")), true);
  assert.equal(existsSync(path.join(packed, "cdk", "cdk.out")), false);
  assert.equal(existsSync(path.join(cache, "cdk", "cdk.out")), false);
});

test("ensure reuses a materialized cache and leftover clones still lose", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-reuse-home-"));
  const leftover = path.join(home, "context101");
  await makeRepoFixture(leftover);

  const pkg = await mkdtemp(path.join(tmpdir(), "ctx101-reuse-pkg-"));
  const packed = path.join(pkg, "stack");
  await mkdir(packed, { recursive: true });
  await makePackedStackFixture(packed);

  const first = await ensureStackRoot({
    cwd: leftover,
    homeDir: home,
    packageDir: pkg,
    version: VERSION,
    env: {},
  });
  const second = await ensureStackRoot({
    cwd: leftover,
    homeDir: home,
    packageDir: pkg,
    version: VERSION,
    env: {},
  });
  assert.equal(first.stackRoot, second.stackRoot);
  assert.equal(second.materialized, undefined);
  assert.equal(resolveStackRoot({
    cwd: leftover,
    homeDir: home,
    packageDir: pkg,
    version: VERSION,
    env: {},
  }), first.stackRoot);
  assert.notEqual(first.stackRoot, leftover);
});

test("CONTEXT101_STACK_ROOT pointing at the published package is rematerialized", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-env-pub-"));
  const pkg = path.join(home, "lib", "node_modules", "context101-cli");
  const packed = path.join(pkg, "stack");
  await mkdir(packed, { recursive: true });
  await makePackedStackFixture(packed);

  const resolved = resolveStackRoot({
    env: { CONTEXT101_STACK_ROOT: packed },
    homeDir: home,
    packageDir: pkg,
    version: VERSION,
  });
  assert.equal(resolved, null);

  const ensured = await ensureStackRoot({
    env: { CONTEXT101_STACK_ROOT: packed },
    homeDir: home,
    packageDir: pkg,
    version: VERSION,
  });
  assert.equal(ensured.ok, true);
  assert.equal(ensured.stackRoot, writableCacheDest(VERSION, home));
  assert.notEqual(ensured.stackRoot, packed);
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
  const cached = path.join(home, ".cache", "context101", VERSION);
  await mkdir(cached, { recursive: true });
  await makePackedStackFixture(cached);

  const pkg = await mkdtemp(path.join(tmpdir(), "ctx101-cache-pkg-"));
  const resolved = resolveStackRoot({
    cwd: home,
    homeDir: home,
    packageDir: pkg,
    version: VERSION,
    env: {},
  });
  assert.equal(resolved, cached);
  assert.equal(cacheStackRoot(VERSION, home), cached);
});

test("cdk output for a cache stack sits beside the source, not inside it", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-out-home-"));
  const cached = path.join(home, ".cache", "context101", VERSION);
  const out = cdkOutputDir(cached, { homeDir: home, version: VERSION });
  assert.equal(out, `${cached}.cdk.out`);
  assert.equal(out.startsWith(cached + path.sep), false);
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

test("pack-stack ships cdk lockfile, web/, and the Amplify monorepo files", async () => {
  const src = await readFile(fileURLToPath(new URL("../scripts/pack-stack.js", import.meta.url)), "utf8");
  assert.match(src, /copyRel\("cdk"\)/);
  assert.match(src, /cdk\/package-lock\.json/);
  assert.match(src, /"cdk\.out"/);
  assert.match(src, /copyRel\("web"\)/);
  assert.match(src, /copyRel\("amplify.yml"\)/);
  assert.match(src, /copyRel\("package-lock.json"\)/);
  assert.match(src, /"stack"/);

  const cdkLock = fileURLToPath(new URL("../../../cdk/package-lock.json", import.meta.url));
  const lock = JSON.parse(await readFile(cdkLock, "utf8"));
  assert.equal(lock.name, "context101-cdk");
});

test("asset exclude covers cdk.out at any depth", async () => {
  const exclude = await readFile(
    fileURLToPath(new URL("../../../cdk/lib/asset-exclude.ts", import.meta.url)),
    "utf8"
  );
  assert.match(exclude, /"cdk\.out"/);
  assert.match(exclude, /"\*\*\/cdk\.out"/);

  const stack = await readFile(
    fileURLToPath(new URL("../../../cdk/lib/context101-stack.ts", import.meta.url)),
    "utf8"
  );
  assert.match(stack, /CDK_OUT_EXCLUDE/);
  assert.match(stack, /fromImageAsset\(/);

  const dockerignore = await readFile(
    fileURLToPath(new URL("../../../.dockerignore", import.meta.url)),
    "utf8"
  );
  assert.match(dockerignore, /^cdk\.out$/m);
  assert.match(dockerignore, /^\*\*\/cdk\.out$/m);
});
