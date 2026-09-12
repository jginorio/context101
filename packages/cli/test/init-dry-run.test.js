import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../src/main.js";
import { DRIVER_NEON } from "../src/defaults.js";
import { fakeExec, makeRepoFixture, memoryIo, testEnv } from "./helpers.js";

test("dry-run prints the plan and writes nothing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-dry-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const secretUrl = "postgresql://user:dry-run-secret-db@db.neon.tech/app";
  let deployed = false;

  const code = await main(
    ["init", "--dry-run", "--database-url", secretUrl, "--seed"],
    {
      cwd: root,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec(),
      runDeploy: async () => {
        deployed = true;
        return 0;
      },
    }
  );

  assert.equal(code, 0);
  const text = `${io.stdoutText}\n${io.stderrText}`;
  assert.match(text, /Context101/);
  assert.match(text, /dry-run/);
  assert.match(text, /Would write: cdk\/\.deploy-env/);
  assert.match(text, /Would not deploy/);
  assert.match(text, /\/setup/);
  assert.match(text, /Amplify default domain/);
  assert.match(text, /deploy\.sh --seed/);
  assert.equal(text.includes("would ask which profile"), false);
  assert.match(text, /would ask for AWS access key and secret/);
  assert.match(text, /https:\/\/github.com\/acme\/context101/);
  assert.match(text, new RegExp(DRIVER_NEON));
  assert.equal(text.includes(secretUrl), false);
  assert.equal(text.includes("dry-run-secret-db"), false);
  assert.equal(text.includes("gho_test_token_must_never_appear"), false);
  assert.equal(text.includes("site/"), false);
  assert.equal(text.includes("example-do-not-copy"), false);
  assert.equal(text.includes("would ask which profile"), false);
  assert.equal(deployed, false);

  const { existsSync } = await import("node:fs");
  assert.equal(existsSync(path.join(root, "cdk", ".deploy-env")), false);
});

test("dry-run lists AWS profiles when several exist", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-dry-prof-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const env = testEnv();

  const code = await main(["init", "--dry-run"], {
    cwd: root,
    env,
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec({
      "aws configure list-profiles": {
        ok: true,
        code: 0,
        stdout: "findit\nplateapr\n",
        stderr: "",
        error: null,
      },
    }),
  });

  assert.equal(code, 0);
  assert.match(io.stdoutText, /would ask which profile: findit, plateapr/);
});

test("dry-run strips credentials from the git remote", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-cred-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const leak = "super-secret-git-remote-token";

  const code = await main(["init", "--dry-run"], {
    cwd: root,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec({
      [`git -C ${root} remote get-url origin`]: {
        ok: true,
        code: 0,
        stdout: `https://x-access-token:${leak}@github.com/acme/context101.git`,
        stderr: "",
        error: null,
      },
    }),
  });

  assert.equal(code, 0);
  const text = `${io.stdoutText}\n${io.stderrText}`;
  assert.equal(text.includes(leak), false);
  assert.equal(text.includes("x-access-token"), false);
  assert.match(text, /https:\/\/github.com\/acme\/context101/);
});

test("dry-run with static AWS keys does not print them", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-dry-keys-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const secret = "test-secret-access-key-must-never-appear";

  const code = await main(["init", "--dry-run"], {
    cwd: root,
    env: testEnv({
      AWS_ACCESS_KEY_ID: "TESTACCESSKEYID12345",
      AWS_SECRET_ACCESS_KEY: secret,
    }),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(),
  });

  assert.equal(code, 0);
  const text = `${io.stdoutText}\n${io.stderrText}`;
  assert.match(text, /using AWS access keys/);
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes("TESTACCESSKEYID12345"), false);
});
