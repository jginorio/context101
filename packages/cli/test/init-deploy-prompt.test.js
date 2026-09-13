import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "./run-main.js";
import { nextSteps } from "../src/plan.js";
import { deployNowMessage, existingEnvContinueMessage } from "../src/prompt.js";
import { DEFAULT_SPACE, defaultSpaceEnvPath } from "../src/spaces.js";
import { monorepoStackRoot } from "../src/stack-source.js";
import {
  fakeExec,
  keepDefaultSpace,
  makeRepoFixture,
  memoryIo,
  tempHome,
  testEnv,
} from "./helpers.js";

function interactiveAnswers(defaults, extra = {}) {
  return {
    region: defaults.region,
    repository: defaults.repository || "",
    databaseUrl: extra.databaseUrl ?? "postgresql://localhost/db",
    databaseDriver: "postgres-js",
    databasePrepare: true,
    createRds: extra.createRds ?? false,
    awsProfile: defaults.awsProfile,
    awsAccessKeyId: defaults.awsAccessKeyId,
    awsSecretAccessKey: defaults.awsSecretAccessKey,
  };
}

test("nextSteps is a one-liner and --seed only when asked", () => {
  assert.equal(nextSteps({ seed: false }), "context101 deploy");
  assert.equal(nextSteps({ seed: true }), "context101 deploy --seed");
  assert.equal(deployNowMessage(), "Deploy the stack now?");
  assert.match(deployNowMessage({ createRds: true }), /creates RDS/);
  assert.equal(existingEnvContinueMessage(), "Continue with these values?");
  assert.equal(existingEnvContinueMessage().includes("—"), false);
});

test("interactive init asks to deploy and respects no", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-ask-no-"));
  const home = await tempHome();
  await makeRepoFixture(root);
  const io = memoryIo();
  io.stdout.isTTY = true;
  io.stdin.isTTY = true;
  const asked = [];
  let deployed = false;

  const code = await main(
    ["init", "--database-url", "postgresql://localhost/db", "--force"],
    {
      cwd: root,
      homeDir: home,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec(),
      promptSpace: keepDefaultSpace,
      promptAwsKeys: async () => ({
        accessKeyId: "TESTACCESSKEYID12345",
        secretAccessKey: "test-secret-access-key-must-never-appear",
      }),
      promptAnswers: async ({ defaults }) => interactiveAnswers(defaults),
      confirmDeploy: async (details) => {
        asked.push(details);
        return false;
      },
      runDeploy: async () => {
        deployed = true;
        return 0;
      },
    }
  );

  assert.equal(code, 0);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].createRds, false);
  assert.equal(asked[0].seed, false);
  assert.equal(deployed, false);
  assert.equal(existsSync(defaultSpaceEnvPath(DEFAULT_SPACE, home)), true);
  assert.match(io.stdoutText, /spaces\/default\/deploy-env/);
  assert.match(io.stdoutText, /^context101 deploy$/m);
  assert.equal(io.stdoutText.includes("Deploying the stack"), false);
  assert.equal(io.stdoutText.includes("First time?"), false);
  assert.equal(io.stdoutText.includes("BETTER_AUTH_URL"), false);
  assert.equal(io.stdoutText.includes("ControlPlaneDbSecretArn"), false);
  assert.equal(io.stdoutText.includes("Bedrock embedding access:"), false);
});

test("interactive init asks to deploy and respects yes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-ask-yes-"));
  const home = await tempHome();
  await makeRepoFixture(root);
  const io = memoryIo();
  io.stdout.isTTY = true;
  io.stdin.isTTY = true;
  const asked = [];
  const calls = [];

  const code = await main(
    ["init", "--database-url", "postgresql://localhost/db", "--force"],
    {
      cwd: root,
      homeDir: home,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec(),
      promptSpace: keepDefaultSpace,
      promptAwsKeys: async () => ({
        accessKeyId: "TESTACCESSKEYID12345",
        secretAccessKey: "test-secret-access-key-must-never-appear",
      }),
      promptAnswers: async ({ defaults }) => interactiveAnswers(defaults),
      confirmDeploy: async (details) => {
        asked.push(details);
        return true;
      },
      runDeploy: async (spec) => {
        calls.push(spec);
        return 0;
      },
    }
  );

  assert.equal(code, 0);
  assert.equal(asked.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].repoRoot, monorepoStackRoot());
  assert.equal(calls[0].seed, false);
  assert.match(io.stdoutText, /spaces\/default\/deploy-env/);
  assert.match(io.stdoutText, /[Dd]eploying/);
  assert.equal(io.stdoutText.includes("cdk deploy"), false);
  assert.equal(io.stdoutText.includes("deploy.sh"), false);
  assert.equal(/^context101 deploy$/m.test(io.stdoutText), false);
});

test("interactive --deploy deploys without asking", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-flag-dep-"));
  const home = await tempHome();
  await makeRepoFixture(root);
  const io = memoryIo();
  io.stdout.isTTY = true;
  io.stdin.isTTY = true;
  let asked = false;
  const calls = [];

  const code = await main(
    ["init", "--deploy", "--database-url", "postgresql://localhost/db", "--force"],
    {
      cwd: root,
      homeDir: home,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec(),
      promptSpace: keepDefaultSpace,
      promptAwsKeys: async () => ({
        accessKeyId: "TESTACCESSKEYID12345",
        secretAccessKey: "test-secret-access-key-must-never-appear",
      }),
      promptAnswers: async ({ defaults }) => interactiveAnswers(defaults),
      confirmDeploy: async () => {
        asked = true;
        return false;
      },
      runDeploy: async (spec) => {
        calls.push(spec);
        return 0;
      },
    }
  );

  assert.equal(code, 0);
  assert.equal(asked, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].repoRoot, monorepoStackRoot());
  assert.match(io.stdoutText, /[Dd]eploying/);
});

test("--yes does not deploy without --deploy and does not ask", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-yes-nod-"));
  const home = await tempHome();
  await makeRepoFixture(root);
  const io = memoryIo();
  io.stdout.isTTY = true;
  io.stdin.isTTY = true;
  let asked = false;
  let deployed = false;

  const code = await main(
    ["init", "--yes", "--database-url", "postgresql://localhost/db", "--force"],
    {
      cwd: root,
      homeDir: home,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec(),
      confirmDeploy: async () => {
        asked = true;
        return true;
      },
      runDeploy: async () => {
        deployed = true;
        return 0;
      },
    }
  );

  assert.equal(code, 0);
  assert.equal(asked, false);
  assert.equal(deployed, false);
  assert.match(io.stdoutText, /spaces\/default\/deploy-env/);
  assert.match(io.stdoutText, /^context101 deploy$/m);
  assert.equal(io.stdoutText.includes("Deploying the stack"), false);
  assert.equal(io.stdoutText.includes("First time?"), false);
  assert.equal(io.stdoutText.includes("BETTER_AUTH_URL"), false);
});

test("--yes --seed prints the --seed next step and does not deploy", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-yes-seed-"));
  const home = await tempHome();
  await makeRepoFixture(root);
  const io = memoryIo();
  let deployed = false;

  const code = await main(
    [
      "init",
      "--yes",
      "--seed",
      "--database-url",
      "postgresql://localhost/db",
      "--force",
    ],
    {
      cwd: root,
      homeDir: home,
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
  assert.equal(deployed, false);
  assert.match(io.stdoutText, /^context101 deploy --seed$/m);
});

test("--yes --deploy deploys without asking", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-yes-dep-"));
  const home = await tempHome();
  await makeRepoFixture(root);
  const io = memoryIo();
  let asked = false;
  const calls = [];

  const code = await main(
    [
      "init",
      "--yes",
      "--deploy",
      "--database-url",
      "postgresql://localhost/db",
      "--force",
    ],
    {
      cwd: root,
      homeDir: home,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec(),
      confirmDeploy: async () => {
        asked = true;
        return false;
      },
      runDeploy: async (spec) => {
        calls.push(spec);
        return 0;
      },
    }
  );

  assert.equal(code, 0);
  assert.equal(asked, false);
  assert.equal(calls.length, 1);
  assert.match(io.stdoutText, /[Dd]eploying/);
  assert.equal(/^context101 deploy$/m.test(io.stdoutText), false);
});

test("dry-run never asks and never deploys", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-dry-ask-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  io.stdout.isTTY = true;
  io.stdin.isTTY = true;
  let asked = false;
  let deployed = false;

  const code = await main(["init", "--dry-run"], {
    cwd: root,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(),
    confirmDeploy: async () => {
      asked = true;
      return true;
    },
    runDeploy: async () => {
      deployed = true;
      return 0;
    },
  });

  assert.equal(code, 0);
  assert.equal(asked, false);
  assert.equal(deployed, false);
  assert.equal(existsSync(path.join(root, "cdk", ".deploy-env")), false);
  assert.match(io.stdoutText, /Would not deploy/);
});

test("interactive yes deploys from CLI stack source without cloning", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-clone-dep-"));
  const home = await tempHome();
  const io = memoryIo();
  io.stdout.isTTY = true;
  io.stdin.isTTY = true;
  const calls = [];

  const code = await main(["init", "--force"], {
    cwd,
    homeDir: home,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: (spec) => {
      if (spec.command === "git" && spec.args?.[0] === "clone") {
        throw new Error("should not clone");
      }
      return fakeExec()(spec);
    },
    promptSpace: keepDefaultSpace,
    promptAwsKeys: async () => ({
      accessKeyId: "TESTACCESSKEYID12345",
      secretAccessKey: "test-secret-access-key-must-never-appear",
    }),
    promptAnswers: async ({ defaults }) =>
      interactiveAnswers(defaults, { createRds: true, databaseUrl: "" }),
    confirmDeploy: async (details) => {
      assert.equal(details.createRds, true);
      return true;
    },
    runDeploy: async (spec) => {
      calls.push(spec);
      return 0;
    },
  });

  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].stackRoot || calls[0].repoRoot);
  assert.equal(existsSync(defaultSpaceEnvPath(DEFAULT_SPACE, home)), true);
  assert.equal(io.stdoutText.includes("cloned into"), false);
  assert.match(io.stdoutText, /[Dd]eploying/);
});
