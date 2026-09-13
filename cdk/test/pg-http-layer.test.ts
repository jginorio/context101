import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertPgHttpManifest,
  pgHttpDockerCommand,
  stagePgHttpIntoNodeModules,
  tryBundlePgHttp,
} from "../lib/pg-http-layer";

const layerSrc = path.resolve(__dirname, "..", "layers", "pg-http");

test("layer package.json does not use a file: path npm will delete", async () => {
  const pkg = JSON.parse(
    await readFile(path.join(layerSrc, "nodejs", "package.json"), "utf8")
  );
  assert.equal(pkg.dependencies.pg, "^8.16.3");
  assert.equal(pkg.dependencies["pg-http"], undefined);
  assertPgHttpManifest(layerSrc);
});

test("docker bundle command does not use cp -au", () => {
  const command = pgHttpDockerCommand();
  assert.equal(command.includes("cp -au"), false);
  assert.equal(command.includes("cp -a "), false);
  assert.match(command, /cp -R \. \/asset-output/);
  assert.match(command, /cp -R pg-http node_modules\/pg-http/);
});

test("tryBundle succeeds when the layer source is present", async () => {
  const dest = await mkdtemp(path.join(tmpdir(), "ctx101-pghttp-"));
  const ok = tryBundlePgHttp(layerSrc, dest, () => Buffer.from(""));
  assert.equal(ok, true);
  assert.equal(
    existsSync(path.join(dest, "nodejs", "node_modules", "pg-http", "index.js")),
    true
  );
});

test("stage copies pg-http beside package.json into node_modules", async () => {
  const dest = await mkdtemp(path.join(tmpdir(), "ctx101-pghttp-stage-"));
  const ok = tryBundlePgHttp(layerSrc, dest, () => {
    throw new Error("npm should be injectable");
  });
  assert.equal(ok, false);
  const staged = await mkdtemp(path.join(tmpdir(), "ctx101-pghttp-ok-"));
  tryBundlePgHttp(layerSrc, staged, () => Buffer.from(""));
  stagePgHttpIntoNodeModules(path.join(staged, "nodejs"));
  const body = await readFile(
    path.join(staged, "nodejs", "node_modules", "pg-http", "package.json"),
    "utf8"
  );
  assert.match(body, /"name": "pg-http"/);
});
