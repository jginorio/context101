import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runCdk } from "../src/cdk-invoke.js";
import { SIGINT_EXIT } from "../src/cancel.js";
import { parseArgs } from "../src/parse-args.js";
import { formatQuietFailure, lastUsefulError } from "../src/quiet.js";
import { fakeExec, makeRepoFixture, memoryIo, testEnv, writeTestDeployEnv } from "./helpers.js";

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
