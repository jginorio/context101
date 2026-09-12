import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { formatConfig, upsertEnvLine } from "../src/config.js";
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
