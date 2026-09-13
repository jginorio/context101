import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runCdk } from "../src/cdk-invoke.js";
import { INSTALLING_DEPS, checkoutNeededMessage, ensureCheckoutDeps } from "../src/checkout-deps.js";
import { cdkOutputDir, writableCacheDest } from "../src/stack-source.js";
import { UPDATING_CHECKOUT } from "../src/clone.js";
import { main } from "./run-main.js";
import { STACK_NAME } from "../src/defaults.js";
import {
  fakeExec,
  makePackedStackFixture,
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

function gitPullCalls(calls) {
  return calls.filter(
    (call) =>
      call.command === "git" &&
      call.args.includes("pull") &&
      call.args.includes("--ff-only")
  );
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

test("deploy does not git pull the user checkout", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-cdk-nopull-"));
  await makeRepoFixture(root, { deps: false });
  await writeTestDeployEnv(root);
  const io = memoryIo();
  const execCalls = [];
  const { calls: spawnCalls, spawnFn } = fakeSpawnRecorder();

  const code = await runCdk({
    repoRoot: root,
    stackRoot: root,
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
  assert.equal(gitPullCalls(execCalls).length, 0);
  const ci = npmCiCalls(execCalls);
  assert.equal(ci.length, 1);
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].command, path.join(root, "node_modules", ".bin", "cdk"));
  assert.equal(spawnCalls[0].args[0], "deploy");
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
  assert.equal(gitPullCalls(execCalls).length, 0);
  assert.equal(io.stdoutText.includes(INSTALLING_DEPS), false);
  assert.equal(io.stdoutText.includes(UPDATING_CHECKOUT), false);
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
    assert.equal(gitPullCalls(execCalls).length, 0, argv.join(" "));
    assert.equal(io.stdoutText.includes(INSTALLING_DEPS), false);
    assert.equal(io.stdoutText.includes(UPDATING_CHECKOUT), false);
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
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-init-ci-home-"));
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
      homeDir: home,
      env: testEnv({
        CONTEXT101_STACK_ROOT: root,
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
  assert.match(io.stdoutText, /spaces\/default\/deploy-env/);
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
        CONTEXT101_STACK_ROOT: root,
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
      CONTEXT101_STACK_ROOT: root,
      AWS_ACCESS_KEY_ID: "TESTACCESSKEYID12345",
      AWS_SECRET_ACCESS_KEY: "test-secret-access-key-must-never-appear",
    }),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: recordingExec(fakeExec(), execCalls),
    promptSpace: async () => "default",
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

test("packaged stack installs from cdk/ without web/ or a root lockfile", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-packed-ci-"));
  await makePackedStackFixture(root, { deps: false });
  const execCalls = [];
  const ready = ensureCheckoutDeps({
    repoRoot: root,
    exec: recordingExec(fakeExec(), execCalls),
  });

  assert.equal(ready.ok, true);
  assert.equal(ready.installed, true);
  const ci = npmCiCalls(execCalls);
  assert.equal(ci.length, 1);
  assert.equal(ci[0].cwd, path.join(root, "cdk"));
});

test("runCdk accepts a packaged stack without web/package.json", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-packed-cdk-"));
  await makePackedStackFixture(root, { deps: false });
  await writeTestDeployEnv(root);
  const io = memoryIo();
  const execCalls = [];
  const { calls: spawnCalls, spawnFn } = fakeSpawnRecorder();

  const code = await runCdk({
    repoRoot: root,
    stackRoot: root,
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
  assert.equal(io.stderrText.includes("Context101 checkout"), false);
  assert.equal(io.stderrText.includes(checkoutNeededMessage()), false);
  const ci = npmCiCalls(execCalls);
  assert.equal(ci.length, 1);
  assert.equal(ci[0].cwd, path.join(root, "cdk"));
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].command, path.join(root, "cdk", "node_modules", ".bin", "cdk"));
  assert.equal(spawnCalls[0].cwd, path.join(root, "cdk"));
});

test("refuses npm ci inside the published CLI package", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-pub-ci-"));
  const pkg = path.join(home, "lib", "node_modules", "context101-cli");
  const packed = path.join(pkg, "stack");
  await makePackedStackFixture(packed, { deps: false });
  const execCalls = [];
  const ready = ensureCheckoutDeps({
    repoRoot: packed,
    packageDir: pkg,
    exec: recordingExec(fakeExec(), execCalls),
  });

  assert.equal(ready.ok, false);
  assert.match(ready.error, /published CLI package/);
  assert.equal(npmCiCalls(execCalls).length, 0);
});

test("packaged cache deploy uses --output outside the stack source", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-cache-out-"));
  const version = "0.1.15";
  const cache = writableCacheDest(version, home);
  await makePackedStackFixture(cache, { deps: false });
  await writeTestDeployEnv(cache);
  const io = memoryIo();
  const execCalls = [];
  const { calls: spawnCalls, spawnFn } = fakeSpawnRecorder();

  const code = await runCdk({
    repoRoot: cache,
    stackRoot: cache,
    action: "deploy",
    env: testEnv(),
    homeDir: home,
    version,
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
  assert.equal(spawnCalls.length, 1);
  const output = cdkOutputDir(cache, { homeDir: home, version });
  assert.ok(output);
  assert.equal(output.startsWith(cache + path.sep), false);
  const idx = spawnCalls[0].args.indexOf("--output");
  assert.notEqual(idx, -1);
  assert.equal(spawnCalls[0].args[idx + 1], output);
  assert.equal(spawnCalls[0].cwd, path.join(cache, "cdk"));
  const ci = npmCiCalls(execCalls);
  assert.equal(ci.length, 1);
  assert.equal(ci[0].cwd, path.join(cache, "cdk"));
});

test("runCdk refuses to synth inside the published CLI package", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-pub-synth-"));
  const pkg = path.join(home, "lib", "node_modules", "context101-cli");
  const packed = path.join(pkg, "stack");
  await makePackedStackFixture(packed, { deps: false });
  await writeTestDeployEnv(packed);
  const io = memoryIo();
  const { calls: spawnCalls, spawnFn } = fakeSpawnRecorder();

  const code = await runCdk({
    repoRoot: packed,
    stackRoot: packed,
    action: "deploy",
    env: testEnv(),
    homeDir: home,
    packageDir: pkg,
    exec: fakeExec(),
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
  assert.match(io.stderrText, /published CLI package/);
});

test("cdk.json app cannot download a bare ts-node", async () => {
  const cdkJsonPath = fileURLToPath(new URL("../../../cdk/cdk.json", import.meta.url));
  const cdkJson = JSON.parse(await readFile(cdkJsonPath, "utf8"));
  assert.match(String(cdkJson.app), /npx --no-install ts-node|--prefer-ts-exts/);
  assert.equal(String(cdkJson.app).includes("npx ts-node"), false);
});
