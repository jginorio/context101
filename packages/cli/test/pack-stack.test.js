import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { copyRel, packStack, SKIP } from "../scripts/pack-stack.js";

function write(rel, contents, root) {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

async function makePackFixture() {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "ctx101-pack-mono-"));
  write("cdk/package-lock.json", '{"name":"context101-cdk","lockfileVersion":3}\n', repoRoot);
  write("cdk/cdk.json", '{"app":"npx ts-node bin/context101.ts"}\n', repoRoot);
  write("wiki-generator-ts/.keep", "", repoRoot);
  write("knowledge/.keep", "", repoRoot);
  write("web/package.json", '{"name":"web"}\n', repoRoot);
  write("web/.next/cache", "skip-me\n", repoRoot);
  write("packages/design/package.json", '{"name":"@context101/design"}\n', repoRoot);
  write("packages/ui/package.json", '{"name":"@context101/ui"}\n', repoRoot);
  write(
    "packages/cli/package.json",
    '{"name":"context101-cli","version":"0.1.21"}\n',
    repoRoot
  );
  write("packages/cli/bin/context101.js", "#!/usr/bin/env node\n", repoRoot);
  write("packages/cli/src/main.js", "export {}\n", repoRoot);
  write("packages/cli/scripts/pack-stack.js", "export {}\n", repoRoot);
  write("packages/cli/node_modules/leftpad/index.js", "export {}\n", repoRoot);
  write("packages/cli/stack/stale/nested.json", '{"nested":true}\n', repoRoot);
  write("packages/cli/dist/bundle.js", "skip-me\n", repoRoot);
  write("packages/cli/coverage/lcov.info", "skip-me\n", repoRoot);
  write("scripts/postinstall.sh", "#!/bin/sh\n", repoRoot);
  write("amplify.yml", "version: 1\n", repoRoot);
  write("package.json", '{"name":"context101","private":true}\n', repoRoot);
  write("package-lock.json", '{"lockfileVersion":3}\n', repoRoot);
  write("Dockerfile", "FROM scratch\n", repoRoot);
  write("requirements.txt", "fastapi\n", repoRoot);
  write("server.py", "print('ok')\n", repoRoot);
  write("search_filter.py", "SEARCH_EXCLUDED_SOURCES = []\n", repoRoot);
  return repoRoot;
}

test("copyRel packages/cli into dest under itself does not EINVAL or nest stack/stack", async () => {
  const repoRoot = await makePackFixture();
  const dest = path.join(repoRoot, "packages", "cli", "stack");

  copyRel("packages/cli", repoRoot, dest);

  const packedPkg = path.join(dest, "packages", "cli", "package.json");
  assert.equal(existsSync(packedPkg), true);
  const pkg = JSON.parse(await readFile(packedPkg, "utf8"));
  assert.equal(pkg.name, "context101-cli");
  assert.equal(pkg.version, "0.1.21");
  assert.equal(existsSync(path.join(dest, "packages", "cli", "bin", "context101.js")), true);
  assert.equal(existsSync(path.join(dest, "packages", "cli", "src", "main.js")), true);
  assert.equal(existsSync(path.join(dest, "packages", "cli", "scripts", "pack-stack.js")), true);

  assert.equal(existsSync(path.join(dest, "packages", "cli", "stack")), false);
  assert.equal(existsSync(path.join(dest, "stack")), false);
  assert.equal(existsSync(path.join(dest, "packages", "cli", "node_modules")), false);
  assert.equal(existsSync(path.join(dest, "packages", "cli", "dist")), false);
  assert.equal(existsSync(path.join(dest, "packages", "cli", "coverage")), false);
});

test("packStack on a monorepo fixture writes stack/packages/cli without nesting stack/stack", async () => {
  const repoRoot = await makePackFixture();
  const dest = path.join(repoRoot, "packages", "cli", "stack");

  packStack(repoRoot, dest);

  const packedPkg = path.join(dest, "packages", "cli", "package.json");
  assert.equal(existsSync(packedPkg), true);
  const pkg = JSON.parse(await readFile(packedPkg, "utf8"));
  assert.equal(pkg.name, "context101-cli");
  assert.equal(existsSync(path.join(dest, "cdk", "package-lock.json")), true);
  assert.equal(existsSync(path.join(dest, "web", "package.json")), true);
  assert.equal(existsSync(path.join(dest, "site")), false);
  assert.equal(existsSync(path.join(dest, "amplify.yml")), true);
  assert.equal(existsSync(path.join(dest, "package-lock.json")), true);
  assert.equal(existsSync(path.join(dest, "packages", "cli", "bin", "context101.js")), true);
  assert.equal(existsSync(path.join(dest, "search_filter.py")), true);
  assert.equal(existsSync(path.join(dest, "server.py")), true);

  assert.equal(existsSync(path.join(dest, "packages", "cli", "stack")), false);
  assert.equal(existsSync(path.join(dest, "stack")), false);
  assert.equal(existsSync(path.join(dest, "web", ".next")), false);
  assert.equal(existsSync(path.join(dest, "packages", "cli", "node_modules")), false);
});

test("SKIP still excludes stack, node_modules, and build leftovers", () => {
  for (const name of [
    "node_modules",
    "cdk.out",
    ".deploy-env",
    ".git",
    "dist",
    "coverage",
    "stack",
    ".next",
  ]) {
    assert.equal(SKIP.has(name), true, name);
  }
});
