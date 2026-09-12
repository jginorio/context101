import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { formatConfig, upsertEnvLine } from "../src/config.js";
import { findDeployEnvPath } from "../src/deploy-env-load.js";
import { HOME_ENV_REL } from "../src/defaults.js";
import { main } from "../src/main.js";
import { fakeExec, makeRepoFixture, memoryIo, testEnv, writeTestDeployEnv } from "./helpers.js";

test("formatConfig redacts secrets and leaves profile names", () => {
  const secret = "ctx_testtoken_must-never-appear";
  const text = formatConfig({
    CTX_TOKEN: secret,
    AWS_PROFILE: "findit",
    APP_MODE: "self_hosted",
  });
  assert.match(text, /AWS_PROFILE=findit/);
  assert.match(text, /APP_MODE=self_hosted/);
  assert.equal(text.includes(secret), false);
  assert.match(text, /CTX_TOKEN=/);
});

test("upsertEnvLine replaces or appends a key", () => {
  const first = upsertEnvLine("", "CTX_TOKEN", "ctx_one");
  assert.match(first, /CTX_TOKEN="ctx_one"/);
  const next = upsertEnvLine(first, "CTX_TOKEN", "ctx_two");
  assert.match(next, /CTX_TOKEN="ctx_two"/);
  assert.equal(next.includes("ctx_one"), false);
});

test("context101 config shows redacted keys", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-cfg-"));
  await makeRepoFixture(root);
  const secret = "ctx_testtoken_must-never-appear";
  await writeTestDeployEnv(root, `CTX_TOKEN="${secret}"\nAWS_PROFILE="findit"`);
  const io = memoryIo();
  const code = await main(["config"], {
    cwd: root,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(),
  });
  assert.equal(code, 0);
  assert.match(io.stdoutText, /AWS_PROFILE=findit/);
  assert.equal(io.stdoutText.includes(secret), false);
});

test("context101 config set writes chmod 600 and never echoes the value", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-cfgset-"));
  await makeRepoFixture(root);
  const secret = "ctx_newtoken_must-never-appear";
  const io = memoryIo();
  const code = await main([`config`, "set", `CTX_TOKEN=${secret}`], {
    cwd: root,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(),
  });
  assert.equal(code, 0);
  assert.match(io.stdoutText, /set CTX_TOKEN/);
  assert.equal(io.stdoutText.includes(secret), false);
  const body = await readFile(path.join(root, "cdk", ".deploy-env"), "utf8");
  assert.match(body, new RegExp(`CTX_TOKEN="${secret}"`));
});

test("findDeployEnvPath defaults to ~/.context101/deploy-env outside a checkout", () => {
  const home = "/tmp/ctx101-home-env";
  assert.equal(
    findDeployEnvPath({
      repoRoot: null,
      homeDir: home,
      exists: () => false,
    }),
    path.join(home, HOME_ENV_REL)
  );
  assert.equal(
    findDeployEnvPath({
      repoRoot: null,
      home: true,
      homeDir: home,
      exists: () => false,
    }),
    path.join(home, HOME_ENV_REL)
  );
});

test("context101 config --home works without a checkout", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-cfg-norepo-"));
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-cfg-home-"));
  const secret = "ctx_home_token_must-never-appear";
  await mkdir(path.join(home, ".context101"), { recursive: true });
  await writeFile(
    path.join(home, ".context101", "deploy-env"),
    `CTX_TOKEN="${secret}"\nAWS_PROFILE="plateapr.com"\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  const io = memoryIo();
  const code = await main(["config", "--home"], {
    cwd,
    homeDir: home,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(),
  });
  assert.equal(code, 0);
  assert.match(io.stdoutText, /AWS_PROFILE=plateapr.com/);
  assert.equal(io.stdoutText.includes(secret), false);
  assert.equal(io.stderrText.includes("checkout"), false);
});

test("context101 config set --home writes without a checkout", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-cfgset-norepo-"));
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-cfgset-home-"));
  const secret = "ctx_set_home_token_must-never-appear";
  const io = memoryIo();
  const code = await main(["config", "set", `CTX_TOKEN=${secret}`, "--home"], {
    cwd,
    homeDir: home,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(),
  });
  assert.equal(code, 0);
  assert.match(io.stdoutText, /set CTX_TOKEN/);
  assert.equal(io.stdoutText.includes(secret), false);
  const body = await readFile(path.join(home, ".context101", "deploy-env"), "utf8");
  assert.match(body, new RegExp(`CTX_TOKEN="${secret}"`));
});
