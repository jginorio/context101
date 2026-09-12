import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const deployShSrc = path.resolve(import.meta.dirname, "../../../cdk/deploy.sh");

test("deploy.sh without the CLI tells the user to use context101 deploy", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ctx101-shim-"));
  await copyFile(deployShSrc, path.join(dir, "deploy.sh"));
  await chmod(path.join(dir, "deploy.sh"), 0o755);
  const result = spawnSync("bash", [path.join(dir, "deploy.sh")], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /context101 deploy/);
  assert.equal(result.stderr.includes("cdk deploy"), false);
});

test("deploy.sh execs the CLI deploy command", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-shim-cli-"));
  await mkdir(path.join(root, "cdk"), { recursive: true });
  await mkdir(path.join(root, "packages", "cli", "bin"), { recursive: true });
  await copyFile(deployShSrc, path.join(root, "cdk", "deploy.sh"));
  await chmod(path.join(root, "cdk", "deploy.sh"), 0o755);
  const seen = path.join(root, "cli-args");
  await writeFile(
    path.join(root, "packages", "cli", "bin", "context101.js"),
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(seen)}, process.argv.slice(2).join(" "));
`,
    { mode: 0o755 }
  );
  const result = spawnSync("bash", [path.join(root, "cdk", "deploy.sh"), "--seed"], {
    cwd: path.join(root, "cdk"),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const { readFile } = await import("node:fs/promises");
  const args = await readFile(seen, "utf8");
  assert.equal(args, "deploy --seed");
});
