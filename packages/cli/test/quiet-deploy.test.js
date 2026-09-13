import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runCdk } from "../src/cdk-invoke.js";
import { SIGINT_EXIT } from "../src/cancel.js";
import { startDeploy } from "../src/deploy.js";
import { parseArgs } from "../src/parse-args.js";
import { createProgress } from "../src/progress.js";
import { formatQuietFailure, formatQuietSuccess, lastUsefulError } from "../src/quiet.js";
import { writers } from "../src/style.js";
import { fakeExec, makeRepoFixture, memoryIo, testEnv, writeTestDeployEnv } from "./helpers.js";

const MCP_LAMBDA = "https://d111111abcdef8.cloudfront.net/mcp";
const LEAKY_AFTER_DEPLOY = [
  { OutputKey: "DocsBucketName", OutputValue: "context101-docs-secret-bucket" },
  { OutputKey: "KnowledgeBaseId", OutputValue: "KBIDSECRET" },
  { OutputKey: "ControlPlaneDbSecretArn", OutputValue: "arn:aws:secretsmanager:xx-test-1:1:secret:db" },
  { OutputKey: "WebAppId", OutputValue: "dwebappidsecret" },
  { OutputKey: "CTX_TOKEN", OutputValue: "ctx_must_never_appear_token" },
  { OutputKey: "McpLambdaUrl", OutputValue: MCP_LAMBDA },
];

const CDK_NOISE = [
  "Bundling asset Context101Stack/PgHttpLayer/Code/Stage...",
  "Unable to find image 'public.ecr.aws/sam/build-nodejs20.x:latest' locally",
  "latest: Pulling from amazon/aws-sam-cli-build-image-nodejs20.x",
  "Digest: sha256:deadbeef",
  "Status: Downloaded newer image",
  "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
  "NOTICES",
  "FailedToBundleAsset: docker exited with status 1",
].join("\n");

function fakeSpawn(output, { code = 1, signal = null, waitForKill = false } = {}) {
  const calls = [];
  const spawnFn = (command, args, opts) => {
    calls.push({ command, args, cwd: opts?.cwd, stdio: opts?.stdio });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => child.emit("exit", null, "SIGINT");
    if (!waitForKill) {
      queueMicrotask(() => {
        if (opts?.stdio !== "inherit" && opts?.stdio !== "ignore") {
          child.stderr.emit("data", output);
        }
        child.emit("exit", code, signal);
      });
    }
    return child;
  };
  return { calls, spawnFn };
}

test("--verbose is not -v", () => {
  assert.equal(parseArgs(["-v"]).command, "version");
  assert.equal(parseArgs(["deploy", "--verbose"]).verbose, true);
  assert.throws(() => parseArgs(["deploy", "-v"]), /unknown flag/);
  assert.equal(parseArgs(["deploy", "platea"]).space, "platea");
});

test("lastUsefulError drops docker pull / SAM / CDK notices", () => {
  const useful = lastUsefulError(CDK_NOISE);
  assert.match(useful, /FailedToBundleAsset/);
  assert.equal(useful.includes("public.ecr.aws/sam"), false);
  assert.equal(useful.includes("Pulling from"), false);
  assert.equal(useful.includes("NOTICES"), false);
});

test("quiet deploy does not leak child stdio or secrets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-quiet-"));
  await makeRepoFixture(root);
  await writeTestDeployEnv(root, 'CTX_TOKEN="ctx_quiet_secret_token_xx"');
  const io = memoryIo();
  const dumped = `${CDK_NOISE}\nCTX_TOKEN=ctx_quiet_secret_token_xx`;
  const { calls, spawnFn } = fakeSpawn(dumped, { code: 1 });

  const code = await runCdk({
    repoRoot: root,
    stackRoot: root,
    action: "deploy",
    env: testEnv(),
    exec: fakeExec(),
    envFile: path.join(root, "cdk", ".deploy-env"),
    io: {
      dim() {},
      err(msg) {
        io.stderr.write(`${msg}\n`);
      },
    },
    spawn: spawnFn,
    verbose: false,
  });

  assert.equal(code, 1);
  assert.notEqual(calls[0].stdio, "inherit");
  assert.match(io.stderrText, /FailedToBundleAsset|context101 deploy --verbose/);
  assert.equal(io.stderrText.includes("public.ecr.aws/sam"), false);
  assert.equal(io.stderrText.includes("Pulling from"), false);
  assert.equal(io.stderrText.includes("ctx_quiet_secret_token_xx"), false);
});

test("verbose deploy inherits child stdio", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-verb-"));
  await makeRepoFixture(root);
  await writeTestDeployEnv(root);
  const { calls, spawnFn } = fakeSpawn(CDK_NOISE, { code: 0 });

  const code = await runCdk({
    repoRoot: root,
    stackRoot: root,
    action: "deploy",
    env: testEnv(),
    exec: fakeExec(),
    envFile: path.join(root, "cdk", ".deploy-env"),
    io: { dim() {}, err() {} },
    spawn: spawnFn,
    verbose: true,
  });

  assert.equal(code, 0);
  assert.equal(calls[0].stdio, "inherit");
});

test("SIGINT during quiet deploy prints cancelled and no dump", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-int-"));
  await makeRepoFixture(root);
  await writeTestDeployEnv(root);
  const io = memoryIo();
  const { spawnFn } = fakeSpawn(CDK_NOISE, { waitForKill: true });

  const code = await runCdk({
    repoRoot: root,
    stackRoot: root,
    action: "deploy",
    env: testEnv(),
    exec: fakeExec(),
    envFile: path.join(root, "cdk", ".deploy-env"),
    io: {
      dim(msg) {
        io.stdout.write(`${msg}\n`);
      },
      err(msg) {
        io.stderr.write(`${msg}\n`);
      },
    },
    spawn: spawnFn,
    verbose: false,
    listenSignal: (handler) => {
      queueMicrotask(handler);
      return () => {};
    },
  });

  assert.equal(code, SIGINT_EXIT);
  assert.match(io.stdoutText, /^cancelled$/m);
  assert.equal(io.stderrText.includes("FailedToBundleAsset"), false);
  assert.equal(io.stderrText.includes("public.ecr.aws"), false);
});

test("formatQuietFailure never includes secrets", () => {
  const text = formatQuietFailure({
    output: "boom ctx_quiet_secret_token_xx",
    secrets: ["ctx_quiet_secret_token_xx"],
  });
  assert.equal(text.includes("ctx_quiet_secret_token_xx"), false);
  assert.match(text, /context101 deploy --verbose/);
});

test("formatQuietSuccess is deployed/destroyed plus optional stack name", () => {
  assert.equal(formatQuietSuccess({ action: "deploy", stackName: "Context101Stack" }), "deployed Context101Stack");
  assert.equal(formatQuietSuccess({ action: "destroy", stackName: "Context101Platea" }), "destroyed Context101Platea");
  assert.equal(formatQuietSuccess({ action: "deploy" }), "deployed");
  assert.equal(formatQuietSuccess({ action: "destroy", stackName: "  " }), "destroyed");
});

async function quietSuccessFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-quiet-ok-"));
  await makeRepoFixture(root);
  await writeTestDeployEnv(root);
  const mem = memoryIo();
  mem.stdout.isTTY = true;
  const io = writers({ stdout: mem.stdout, stderr: mem.stderr, env: testEnv() });
  const progress = createProgress({
    stdout: mem.stdout,
    env: testEnv(),
    verbose: false,
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
  });
  return { root, mem, io, progress };
}

test("TTY quiet deploy success prints ok deployed and the stack name", async () => {
  const { root, mem, io, progress } = await quietSuccessFixture();
  const dumped = `${CDK_NOISE}\nCREATE_COMPLETE\nOutputs:\nAdminUrl = https://secret.amplify.app`;
  const { calls, spawnFn } = fakeSpawn(dumped, { code: 0 });

  const code = await runCdk({
    repoRoot: root,
    stackRoot: root,
    action: "deploy",
    env: testEnv(),
    exec: fakeExec(),
    envFile: path.join(root, "cdk", ".deploy-env"),
    io,
    spawn: spawnFn,
    verbose: false,
    progress,
    stackName: "Context101Stack",
  });

  assert.equal(code, 0);
  assert.notEqual(calls[0].stdio, "inherit");
  assert.match(mem.stdoutText, /\r\x1b\[K/);
  assert.match(mem.stdoutText, /✓ deployed Context101Stack/);
  assert.equal(mem.stdoutText.includes("CREATE_COMPLETE"), false);
  assert.equal(mem.stdoutText.includes("AdminUrl"), false);
  assert.equal(mem.stdoutText.includes("amplify.app"), false);
  assert.equal(mem.stdoutText.includes("public.ecr.aws/sam"), false);
  assert.equal(mem.stderrText.includes("FailedToBundleAsset"), false);
});

test("TTY quiet destroy success prints ok destroyed and the stack name", async () => {
  const { root, mem, io, progress } = await quietSuccessFixture();
  const { spawnFn } = fakeSpawn("DELETE_COMPLETE", { code: 0 });

  const code = await runCdk({
    repoRoot: root,
    stackRoot: root,
    action: "destroy",
    env: testEnv(),
    exec: fakeExec(),
    envFile: path.join(root, "cdk", ".deploy-env"),
    io,
    spawn: spawnFn,
    verbose: false,
    progress,
    stackName: "Context101Stack",
  });

  assert.equal(code, 0);
  assert.match(mem.stdoutText, /\r\x1b\[K/);
  assert.match(mem.stdoutText, /✓ destroyed Context101Stack/);
  assert.equal(mem.stdoutText.includes("DELETE_COMPLETE"), false);
});

test("quiet deploy success without a stack name prints ok deployed", async () => {
  const { root, mem, io } = await quietSuccessFixture();
  const { spawnFn } = fakeSpawn("", { code: 0 });

  const code = await runCdk({
    repoRoot: root,
    stackRoot: root,
    action: "deploy",
    env: testEnv(),
    exec: fakeExec(),
    envFile: path.join(root, "cdk", ".deploy-env"),
    io,
    spawn: spawnFn,
    verbose: false,
  });

  assert.equal(code, 0);
  assert.match(mem.stdoutText, /✓ deployed$/m);
  assert.equal(/✓ deployed \S/.test(mem.stdoutText), false);
});

test("quiet deploy success uses STACK_NAME from the env file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-quiet-stack-"));
  await makeRepoFixture(root);
  await writeTestDeployEnv(root, 'STACK_NAME="Context101Platea"');
  const mem = memoryIo();
  const io = writers({ stdout: mem.stdout, stderr: mem.stderr, env: testEnv() });
  const { spawnFn } = fakeSpawn("", { code: 0 });

  const code = await runCdk({
    repoRoot: root,
    stackRoot: root,
    action: "deploy",
    env: testEnv(),
    exec: fakeExec(),
    envFile: path.join(root, "cdk", ".deploy-env"),
    io,
    spawn: spawnFn,
    verbose: false,
  });

  assert.equal(code, 0);
  assert.match(mem.stdoutText, /✓ deployed Context101Platea/);
});

test("verbose deploy success still prints ok deployed", async () => {
  const { root, mem, io } = await quietSuccessFixture();
  const { calls, spawnFn } = fakeSpawn(CDK_NOISE, { code: 0 });

  const code = await runCdk({
    repoRoot: root,
    stackRoot: root,
    action: "deploy",
    env: testEnv(),
    exec: fakeExec(),
    envFile: path.join(root, "cdk", ".deploy-env"),
    io,
    spawn: spawnFn,
    verbose: true,
    stackName: "Context101Stack",
  });

  assert.equal(code, 0);
  assert.equal(calls[0].stdio, "inherit");
  assert.match(mem.stdoutText, /✓ deployed Context101Stack/);
});

test("startDeploy TTY quiet success prints ok deployed after the spinner clears", async () => {
  const { root, mem, io } = await quietSuccessFixture();
  const dumped = `${CDK_NOISE}\nCREATE_COMPLETE`;
  const { spawnFn } = fakeSpawn(dumped, { code: 0 });

  const code = await startDeploy({
    io,
    ctx: {
      stdout: mem.stdout,
      stderr: mem.stderr,
      env: testEnv(),
      cwd: root,
      exec: fakeExec(),
      runDeploy: (opts) => runCdk({ ...opts, spawn: spawnFn }),
    },
    stackRoot: root,
    space: { stackName: "Context101Stack" },
    env: testEnv(),
    envFile: path.join(root, "cdk", ".deploy-env"),
    exec: fakeExec(),
    verbose: false,
    dockerDaemon: true,
  });

  assert.equal(code, 0);
  assert.match(mem.stdoutText, /\r\x1b\[K/);
  assert.match(mem.stdoutText, /✓ deployed Context101Stack/);
  assert.equal(mem.stdoutText.includes("CREATE_COMPLETE"), false);
});

test("TTY quiet deploy success prints urls after ok deployed", async () => {
  const { root, mem, io, progress } = await quietSuccessFixture();
  const { spawnFn } = fakeSpawn("", { code: 0 });

  const code = await runCdk({
    repoRoot: root,
    stackRoot: root,
    action: "deploy",
    env: testEnv(),
    exec: fakeExec({
      describeStacks: {
        ok: true,
        code: 0,
        stdout: JSON.stringify(LEAKY_AFTER_DEPLOY),
        stderr: "",
        error: null,
      },
    }),
    envFile: path.join(root, "cdk", ".deploy-env"),
    io,
    spawn: spawnFn,
    verbose: false,
    progress,
    stackName: "Context101Testingcontext101",
  });

  assert.equal(code, 0);
  assert.match(mem.stdoutText, /✓ deployed Context101Testingcontext101/);
  assert.match(mem.stdoutText, /admin\s+skipped/);
  assert.match(mem.stdoutText, /mcp\s+https:\/\/d111111abcdef8\.cloudfront\.net\/mcp/);
  assert.equal(mem.stdoutText.includes("amplifyapp.com"), false);
  assert.equal(mem.stdoutText.includes("ctx_must_never_appear_token"), false);
  assert.equal(mem.stdoutText.includes("KBIDSECRET"), false);
  assert.equal(mem.stdoutText.includes("secretsmanager"), false);
  assert.equal(mem.stdoutText.includes("CTX_TOKEN"), false);
  assert.equal(mem.stdoutText.includes("bearer"), false);
});

test("quiet deploy still prints ok deployed when describe-stacks fails", async () => {
  const { root, mem, io } = await quietSuccessFixture();
  const { spawnFn } = fakeSpawn("", { code: 0 });

  const code = await runCdk({
    repoRoot: root,
    stackRoot: root,
    action: "deploy",
    env: testEnv(),
    exec: fakeExec({
      describeStacks: {
        ok: false,
        code: 1,
        stdout: "",
        stderr: "An error occurred (ValidationError) when calling the DescribeStacks operation: Stack with id Context101Stack does not exist",
        error: null,
      },
    }),
    envFile: path.join(root, "cdk", ".deploy-env"),
    io,
    spawn: spawnFn,
    verbose: false,
    stackName: "Context101Stack",
  });

  assert.equal(code, 0);
  assert.match(mem.stdoutText, /✓ deployed Context101Stack/);
  assert.equal(mem.stdoutText.includes("admin"), false);
  assert.equal(mem.stdoutText.includes("mcp"), false);
  assert.equal(mem.stderrText.includes("does not exist"), false);
});

test("quiet destroy success does not print urls", async () => {
  const { root, mem, io, progress } = await quietSuccessFixture();
  const { spawnFn } = fakeSpawn("DELETE_COMPLETE", { code: 0 });

  const code = await runCdk({
    repoRoot: root,
    stackRoot: root,
    action: "destroy",
    env: testEnv(),
    exec: fakeExec({
      describeStacks: {
        ok: true,
        code: 0,
        stdout: JSON.stringify(LEAKY_AFTER_DEPLOY),
        stderr: "",
        error: null,
      },
    }),
    envFile: path.join(root, "cdk", ".deploy-env"),
    io,
    spawn: spawnFn,
    verbose: false,
    progress,
    stackName: "Context101Stack",
  });

  assert.equal(code, 0);
  assert.match(mem.stdoutText, /✓ destroyed Context101Stack/);
  assert.equal(mem.stdoutText.includes("admin"), false);
  assert.equal(mem.stdoutText.includes("mcp"), false);
  assert.equal(mem.stdoutText.includes(MCP_LAMBDA), false);
});

test("quiet deploy failure still prints the useful error and not deployed", async () => {
  const { root, mem, io, progress } = await quietSuccessFixture();
  const { spawnFn } = fakeSpawn(CDK_NOISE, { code: 1 });

  const code = await runCdk({
    repoRoot: root,
    stackRoot: root,
    action: "deploy",
    env: testEnv(),
    exec: fakeExec(),
    envFile: path.join(root, "cdk", ".deploy-env"),
    io,
    spawn: spawnFn,
    verbose: false,
    progress,
    stackName: "Context101Stack",
  });

  assert.equal(code, 1);
  assert.match(mem.stdoutText, /\r\x1b\[K/);
  assert.equal(mem.stdoutText.includes("✓ deployed"), false);
  assert.match(mem.stderrText, /FailedToBundleAsset|context101 deploy --verbose/);
});
