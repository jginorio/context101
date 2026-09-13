import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "./run-main.js";
import { fakeExec, makeRepoFixture, memoryIo, testEnv, writeTestDeployEnv } from "./helpers.js";

test("--yes --deploy deploys through the CLI runner", async () => {
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
  assert.match(io.stdoutText, /[Dd]eploying/);
  assert.equal(io.stdoutText.includes("cdk deploy"), false);
  assert.equal(io.stdoutText.includes("deploy.sh"), false);
});

test("context101 deploy refuses to invoke cdk without CTX_TOKEN", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-dep-notoken-"));
  await makeRepoFixture(root);
  await writeTestDeployEnv(root, 'CTX_TOKEN=""');
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(root, "cdk", ".deploy-env"), 'APP_MODE="self_hosted"\n', "utf8");
  const io = memoryIo();
  const calls = [];

  const code = await main(["deploy"], {
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
  });

  assert.equal(code, 1);
  assert.equal(calls.length, 0);
  assert.match(io.stderrText, /CTX_TOKEN/);
  assert.match(io.stderrText, /context101 init|context101 deploy/);
  assert.equal(io.stdoutText.includes("deploy.sh"), false);
});

test("context101 deploy runs the stack deploy", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-dep-cmd-"));
  await makeRepoFixture(root);
  await writeTestDeployEnv(root);
  const io = memoryIo();
  const calls = [];

  const code = await main(["deploy", "--seed"], {
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
  });

  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].repoRoot, root);
  assert.equal(calls[0].seed, true);
  assert.match(io.stdoutText, /[Dd]eploying/);
  assert.equal(io.stdoutText.includes("deploy.sh"), false);
});

test("context101 deploy --dry-run does not deploy", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-dep-dry-"));
  await makeRepoFixture(root);
  await writeTestDeployEnv(root);
  const io = memoryIo();
  const calls = [];

  const code = await main(["deploy", "--dry-run"], {
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
  });

  assert.equal(code, 0);
  assert.equal(calls.length, 0);
  assert.match(io.stdoutText, /context101 deploy/);
  assert.equal(io.stdoutText.includes("deploy.sh"), false);
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

test("context101 deploy finds ./context101 without cd", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-dep-parent-"));
  const dest = path.join(cwd, "context101");
  await makeRepoFixture(dest);
  await writeTestDeployEnv(dest);
  const io = memoryIo();
  const calls = [];

  const code = await main(["deploy"], {
    cwd,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(),
    runDeploy: async (spec) => {
      calls.push(spec);
      return 0;
    },
  });

  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].repoRoot, dest);
  assert.equal(io.stdoutText.includes("Cloning"), false);
});

test("context101 deploy --dry-run finds ./context101 and does not pull", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-dep-parent-dry-"));
  const dest = path.join(cwd, "context101");
  await makeRepoFixture(dest);
  await writeTestDeployEnv(dest);
  const io = memoryIo();
  const execCalls = [];

  const code = await main(["deploy", "--dry-run"], {
    cwd,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: ({ command, args = [], cwd: execCwd } = {}) => {
      execCalls.push({ command, args, cwd: execCwd });
      return fakeExec()({ command, args, cwd: execCwd });
    },
    runDeploy: async () => {
      throw new Error("should not deploy");
    },
  });

  assert.equal(code, 0);
  assert.equal(
    execCalls.some((call) => call.command === "git" && call.args.includes("pull")),
    false
  );
  assert.equal(io.stdoutText.includes("updating checkout"), false);
});

test("context101 deploy needs a space when none exist", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-dep-norepo-"));
  const io = memoryIo();
  const calls = [];

  const code = await main(["deploy", "--dry-run"], {
    cwd,
    homeDir: cwd,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(),
    runDeploy: async (spec) => {
      calls.push(spec);
      return 0;
    },
  });

  assert.equal(code, 1);
  assert.equal(calls.length, 0);
  assert.match(io.stderrText, /no spaces yet|space name/);
});
