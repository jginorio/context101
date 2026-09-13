import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runCdk } from "../src/cdk-invoke.js";
import { INSTALLING_DEPS } from "../src/checkout-deps.js";
import { main } from "../src/main.js";
import { STACK_NAME } from "../src/defaults.js";
import {
  fakeExec,
  makeRepoFixture,
  memoryIo,
  testEnv,
  writeTestDeployEnv,
} from "./helpers.js";

function recordingExec(inner, calls) {
  return (spec) => {
    calls.push({
      command: spec.command,
      args: spec.args || [],
      cwd: spec.cwd,
    });
    return inner(spec);
  };
}

function npmCiCalls(calls) {
  return calls.filter((call) => call.command === "npm" && call.args[0] === "ci");
}

function fakeSpawnRecorder() {
  const calls = [];
  const spawnFn = (command, args, opts) => {
    calls.push({ command, args, cwd: opts?.cwd });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", 0));
    return child;
  };
  return { calls, spawnFn };
}

test("missing node_modules triggers npm ci then local cdk", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-cdk-ci-"));
  await makeRepoFixture(root, { deps: false });
  await writeTestDeployEnv(root);
  const io = memoryIo();
  const execCalls = [];
  const { calls: spawnCalls, spawnFn } = fakeSpawnRecorder();

  const code = await runCdk({
    repoRoot: root,
    action: "deploy",
    env: testEnv(),
    exec: recordingExec(fakeExec(), execCalls),
    io: {
      dim(msg) {
        io.stdout.write(`${msg}\n`);
      },
      err(msg) {
        io.stderr.write(`${msg}\n`);
      },
    },
    spawn: spawnFn,
    stdio: "ignore",
  });

  assert.equal(code, 0);
  const ci = npmCiCalls(execCalls);
  assert.equal(ci.length, 1);
  assert.equal(ci[0].cwd, root);
  assert.match(io.stdoutText, new RegExp(INSTALLING_DEPS));
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].command, path.join(root, "node_modules", ".bin", "cdk"));
  assert.equal(spawnCalls[0].command.includes("npx"), false);
  assert.equal(spawnCalls[0].args[0], "deploy");
  assert.equal(spawnCalls[0].cwd, path.join(root, "cdk"));
});

test("npm ci failure does not spawn cdk", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-cdk-ci-fail-"));
  await makeRepoFixture(root, { deps: false });
  await writeTestDeployEnv(root);
  const io = memoryIo();
  const { calls: spawnCalls, spawnFn } = fakeSpawnRecorder();

  const code = await runCdk({
    repoRoot: root,
    action: "deploy",
    env: testEnv(),
    exec: fakeExec({
      "npm ci": {
        ok: false,
        code: 1,
        stdout: "",
        stderr: "ERESOLVE could not resolve",
        error: null,
      },
    }),
    io: {
      dim() {},
      err(msg) {
        io.stderr.write(`${msg}\n`);
      },
    },
    spawn: spawnFn,
    stdio: "ignore",
  });

  assert.equal(code, 1);
  assert.equal(spawnCalls.length, 0);
  assert.match(io.stderrText, /npm ci failed/);
  assert.equal(io.stderrText.includes("ctx_testtoken_xx"), false);
});

test("deploy --dry-run does not npm ci", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-dep-dry-ci-"));
  await makeRepoFixture(root, { deps: false });
  await writeTestDeployEnv(root);
  const io = memoryIo();
  const execCalls = [];

  const code = await main(["deploy", "--dry-run"], {
    cwd: root,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: recordingExec(fakeExec(), execCalls),
    runDeploy: async () => {
      throw new Error("should not deploy");
    },
  });

  assert.equal(code, 0);
  assert.equal(npmCiCalls(execCalls).length, 0);
  assert.equal(io.stdoutText.includes(INSTALLING_DEPS), false);
});

test("list / help / version do not install", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-noinst-"));
  for (const argv of [["list"], ["help"], ["version"]]) {
    const io = memoryIo();
    const execCalls = [];
    const code = await main(argv, {
      cwd,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: recordingExec(fakeExec(), execCalls),
    });
    assert.equal(code, 0, argv.join(" "));
    assert.equal(npmCiCalls(execCalls).length, 0, argv.join(" "));
    assert.equal(io.stdoutText.includes(INSTALLING_DEPS), false);
  }
});

test("destroy --dry-run does not npm ci", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-rm-dry-ci-"));
  const io = memoryIo();
  const execCalls = [];

  const code = await main(["destroy", STACK_NAME, "--dry-run"], {
    cwd,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: recordingExec(
      fakeExec({
        listStacks: {
          ok: true,
          code: 0,
          stdout: JSON.stringify({
            StackSummaries: [
              {
                StackName: STACK_NAME,
                StackStatus: "CREATE_COMPLETE",
                TemplateDescription: "Context101 self-host",
              },
            ],
          }),
          stderr: "",
          error: null,
        },
      }),
      execCalls
    ),
    runDeploy: async () => {
      throw new Error("should not destroy");
    },
  });

  assert.equal(code, 0);
  assert.equal(npmCiCalls(execCalls).length, 0);
  assert.equal(io.stdoutText.includes(INSTALLING_DEPS), false);
});

test("init installs once when missing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-init-ci-"));
  await makeRepoFixture(root, { deps: false });
  const io = memoryIo();
  const execCalls = [];
  let deployed = false;

  const code = await main(
    [
      "init",
      "--yes",
      "--database-url",
      "postgresql://localhost/db",
      "--force",
    ],
    {
      cwd: root,
      env: testEnv({
        AWS_ACCESS_KEY_ID: "TESTACCESSKEYID12345",
        AWS_SECRET_ACCESS_KEY: "test-secret-access-key-must-never-appear",
      }),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: recordingExec(fakeExec(), execCalls),
      runDeploy: async () => {
        deployed = true;
        return 0;
      },
    }
  );

  assert.equal(code, 0);
  assert.equal(deployed, false);
  assert.equal(npmCiCalls(execCalls).length, 1);
  assert.equal(npmCiCalls(execCalls)[0].cwd, root);
  assert.match(io.stdoutText, new RegExp(INSTALLING_DEPS));
  assert.match(io.stdoutText, /wrote cdk\/\.deploy-env/);
  assert.equal(io.stdoutText.includes("Deploying the stack"), false);
});

test("init skips npm ci when checkout deps are already present", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-init-skip-ci-"));
  await makeRepoFixture(root, { deps: true });
  const io = memoryIo();
  const execCalls = [];

  const code = await main(
    [
      "init",
      "--yes",
      "--database-url",
      "postgresql://localhost/db",
      "--force",
    ],
    {
      cwd: root,
      env: testEnv({
        AWS_ACCESS_KEY_ID: "TESTACCESSKEYID12345",
        AWS_SECRET_ACCESS_KEY: "test-secret-access-key-must-never-appear",
      }),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: recordingExec(fakeExec(), execCalls),
    }
  );

  assert.equal(code, 0);
  assert.equal(npmCiCalls(execCalls).length, 0);
  assert.equal(io.stdoutText.includes(INSTALLING_DEPS), false);
});

test("resume-yes skips npm ci when checkout deps are already present", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-resume-skip-ci-"));
  await makeRepoFixture(root, { deps: true });
  await writeTestDeployEnv(root);
  const io = memoryIo();
  io.stdout.isTTY = true;
  io.stdin.isTTY = true;
  const execCalls = [];

  const code = await main(["init"], {
    cwd: root,
    env: testEnv({
      AWS_ACCESS_KEY_ID: "TESTACCESSKEYID12345",
      AWS_SECRET_ACCESS_KEY: "test-secret-access-key-must-never-appear",
    }),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: recordingExec(fakeExec(), execCalls),
    confirmResume: async () => true,
    confirmDeploy: async () => false,
    runDeploy: async () => {
      throw new Error("should not deploy");
    },
  });

  assert.equal(code, 0);
  assert.equal(npmCiCalls(execCalls).length, 0);
  assert.equal(io.stdoutText.includes(INSTALLING_DEPS), false);
});

test("cdk.json app cannot download a bare ts-node", async () => {
  const cdkJsonPath = fileURLToPath(new URL("../../../cdk/cdk.json", import.meta.url));
  const cdkJson = JSON.parse(await readFile(cdkJsonPath, "utf8"));
  assert.match(String(cdkJson.app), /npx --no-install ts-node|--prefer-ts-exts/);
  assert.equal(String(cdkJson.app).includes("npx ts-node"), false);
});
