import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../src/main.js";
import { fakeExec, makeRepoFixture, memoryIo, testEnv } from "./helpers.js";

test("--yes --deploy calls ./cdk/deploy.sh only", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-dep-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const calls = [];

  const code = await main(
    [
      "init",
      "--yes",
      "--deploy",
      "--seed",
      "--database-url",
      "postgresql://localhost/db",
      "--force",
      "--deploy-env",
      path.join(root, "cdk", ".deploy-env"),
    ],
    {
      cwd: root,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec(),
      runDeploy: async (spec) => {
        calls.push(spec);
        return 0;
      },
    }
  );

  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].repoRoot, root);
  assert.equal(calls[0].seed, true);
  assert.match(io.stdoutText, /Running \.\/cdk\/deploy\.sh/);
  assert.equal(io.stdoutText.includes("cdk deploy"), false);
});

test("--yes --deploy refuses a ghs_ gh token when Amplify watches a repo", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-ghs-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const calls = [];

  const code = await main(
    [
      "init",
      "--yes",
      "--deploy",
      "--repo",
      "https://github.com/acme/context101",
      "--database-url",
      "postgresql://localhost/db",
      "--force",
      "--deploy-env",
      path.join(root, "cdk", ".deploy-env"),
    ],
    {
      cwd: root,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec({
        "gh auth token": {
          ok: true,
          code: 0,
          stdout: "ghs_installation_must_never_appear",
          stderr: "",
          error: null,
        },
      }),
      runDeploy: async (spec) => {
        calls.push(spec);
        return 0;
      },
    }
  );

  assert.equal(code, 1);
  assert.equal(calls.length, 0);
  assert.match(io.stderrText, /PAT|webhook|roll the stack back/i);
  assert.equal(io.stderrText.includes("ghs_installation_must_never_appear"), false);
});

test("--yes --deploy refuses when the Docker daemon is down", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-dock-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const calls = [];

  const code = await main(
    [
      "init",
      "--yes",
      "--deploy",
      "--database-url",
      "postgresql://localhost/db",
      "--force",
      "--deploy-env",
      path.join(root, "cdk", ".deploy-env"),
    ],
    {
      cwd: root,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec({
        "docker info": {
          ok: false,
          code: 1,
          stdout: "",
          stderr: "Cannot connect to the Docker daemon",
          error: null,
        },
      }),
      runDeploy: async (spec) => {
        calls.push(spec);
        return 0;
      },
    }
  );

  assert.equal(code, 1);
  assert.equal(calls.length, 0);
  assert.match(io.stderrText, /Docker daemon is not running/);
  assert.match(`${io.stdoutText}\n${io.stderrText}`, /colima start|systemctl start docker/);
});
