import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_SPACE, defaultSpaceEnvPath } from "../src/spaces.js";
import { main } from "./run-main.js";
import { fakeExec, memoryIo, testEnv } from "./helpers.js";

test("init --dry-run does not clone", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-init-clone-"));
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-init-home-"));
  const io = memoryIo();
  const code = await main(["init", "--dry-run"], {
    cwd,
    homeDir: home,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(),
  });
  assert.equal(code, 0);
  assert.equal(io.stdoutText.includes("Would clone"), false);
  assert.equal(io.stdoutText.includes("git pull"), false);
  assert.match(io.stdoutText, /spaces\/default\/deploy-env|Would write/);
});

test("init writes a space env without cloning", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-init-git-"));
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-init-home2-"));
  const io = memoryIo();
  const code = await main(["init", "--yes", "--force"], {
    cwd,
    homeDir: home,
    env: testEnv({
      AWS_ACCESS_KEY_ID: "TESTACCESSKEYID12345",
      AWS_SECRET_ACCESS_KEY: "test-secret-access-key-must-never-appear",
    }),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: (spec) => {
      if (spec.command === "git" && spec.args?.[0] === "clone") {
        throw new Error("should not clone");
      }
      return fakeExec()(spec);
    },
  });
  assert.equal(code, 0);
  assert.equal(existsSync(defaultSpaceEnvPath(DEFAULT_SPACE, home)), true);
  assert.equal(io.stdoutText.includes("cloned into"), false);
  assert.equal(io.stdoutText.includes("git pull"), false);
});

test("init platea writes that space's stack id and prefix", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-init-platea-"));
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-init-platea-home-"));
  const io = memoryIo();
  const code = await main(["init", "platea", "--yes", "--force"], {
    cwd,
    homeDir: home,
    env: testEnv({
      AWS_ACCESS_KEY_ID: "TESTACCESSKEYID12345",
      AWS_SECRET_ACCESS_KEY: "test-secret-access-key-must-never-appear",
    }),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(),
  });
  assert.equal(code, 0);
  const body = await readFile(defaultSpaceEnvPath("platea", home), "utf8");
  assert.match(body, /SPACE="platea"/);
  assert.match(body, /STACK_NAME="Context101Platea"/);
  assert.match(body, /NAME_PREFIX="context101-platea"/);
  assert.equal(body.includes("CTX_TOKEN="), true);
  assert.equal(io.stdoutText.includes("test-secret-access-key-must-never-appear"), false);
});

test("init default reuses ~/.context101/deploy-env and does not copy it", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-init-home-env-"));
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-init-home-env-home-"));
  const envPath = path.join(home, ".context101", "deploy-env");
  await mkdir(path.dirname(envPath), { recursive: true });
  await writeFile(envPath, 'CTX_TOKEN="ctx_testtoken_xx"\nAPP_MODE="self_hosted"\n', {
    mode: 0o600,
  });
  const io = memoryIo();
  const code = await main(["init", "default", "--yes", "--force"], {
    cwd,
    homeDir: home,
    env: testEnv({
      AWS_ACCESS_KEY_ID: "TESTACCESSKEYID12345",
      AWS_SECRET_ACCESS_KEY: "test-secret-access-key-must-never-appear",
    }),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(),
  });
  assert.equal(code, 0);
  assert.equal(existsSync(envPath), true);
  assert.equal(existsSync(defaultSpaceEnvPath(DEFAULT_SPACE, home)), false);
  const pointer = path.join(home, ".context101", "spaces", "default", "env-path");
  assert.equal((await readFile(pointer, "utf8")).trim(), envPath);
  const body = await readFile(envPath, "utf8");
  assert.match(body, /STACK_NAME="Context101Stack"/);
  assert.match(body, /NAME_PREFIX="context101"/);
  assert.equal(io.stdoutText.includes("test-secret-access-key-must-never-appear"), false);
});
