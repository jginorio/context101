import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { hasAdminSource, pushAdminSource, stageAdminSource } from "../src/admin-source.js";
import { startDeploy } from "../src/deploy.js";
import {
  fakeExec,
  makeRepoFixture,
  memoryIo,
  testEnv,
  writeTestDeployEnv,
} from "./helpers.js";

const CLONE = "https://git-codecommit.us-west-2.amazonaws.com/v1/repos/context101-admin";
const ADMIN = "https://main.d123456789.amplifyapp.com";

async function adminFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-admin-src-"));
  await makeRepoFixture(root);
  await writeFile(path.join(root, "amplify.yml"), "version: 1\n", "utf8");
  await mkdir(path.join(root, "packages", "design"), { recursive: true });
  await writeFile(path.join(root, "packages", "design", "package.json"), '{"name":"@context101/design"}\n');
  return root;
}

test("hasAdminSource wants web/ plus amplify.yml", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-admin-has-"));
  await makeRepoFixture(root);
  assert.equal(hasAdminSource(root), false);
  await writeFile(path.join(root, "amplify.yml"), "version: 1\n", "utf8");
  assert.equal(hasAdminSource(root), true);
});

test("stageAdminSource copies web/ in the monorepo layout", async () => {
  const root = await adminFixture();
  const dest = await mkdtemp(path.join(tmpdir(), "ctx101-admin-stage-"));
  stageAdminSource(root, dest);
  const { existsSync } = await import("node:fs");
  assert.equal(existsSync(path.join(dest, "web", "package.json")), true);
  assert.equal(existsSync(path.join(dest, "amplify.yml")), true);
  assert.equal(existsSync(path.join(dest, "package-lock.json")), true);
});

test("pushAdminSource runs git push --force to CodeCommit (mocked)", async () => {
  const root = await adminFixture();
  const calls = [];
  const result = pushAdminSource({
    stackRoot: root,
    cloneUrl: CLONE,
    version: "0.1.17",
    exec: (spec) => {
      calls.push(spec);
      return { ok: true, code: 0, stdout: "", stderr: "", error: null };
    },
    env: testEnv(),
    region: "us-west-2",
  });

  assert.equal(result.ok, true);
  assert.equal(result.pushed, true);
  const git = calls.filter((c) => c.command === "git");
  assert.ok(git.some((c) => c.args[0] === "init"));
  assert.ok(git.some((c) => c.args.includes("credential.helper")));
  const helper = git.find((c) => c.args.includes("credential.helper"));
  assert.match(helper.args.join(" "), /codecommit credential-helper/);
  assert.equal(helper.args.join(" ").includes("ghp_"), false);
  const push = git.find((c) => c.args[0] === "push");
  assert.ok(push);
  assert.deepEqual(push.args.slice(0, 3), ["push", "--force", "origin"]);
  assert.ok(git.some((c) => c.args[0] === "remote" && c.args.includes(CLONE)));
  const joined = calls.map((c) => [c.command, ...(c.args || [])].join(" ")).join("\n");
  assert.equal(joined.includes("ghp_"), false);
  assert.equal(joined.includes("githubToken"), false);
});

test("pushAdminSource skips when there is no clone URL", () => {
  const result = pushAdminSource({
    stackRoot: "/tmp",
    cloneUrl: "",
    exec: () => {
      throw new Error("should not exec");
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, "no-clone-url");
});

test("startDeploy pushes to CodeCommit after a successful deploy (mocked)", async () => {
  const root = await adminFixture();
  await writeTestDeployEnv(root);
  const io = memoryIo();
  const pushes = [];

  const code = await startDeploy({
    io: {
      write(line) {
        io.stdout.write(`${line}\n`);
      },
      ok(msg) {
        io.stdout.write(`${msg}\n`);
      },
      warn(msg) {
        io.stderr.write(`${msg}\n`);
      },
      err(msg) {
        io.stderr.write(`${msg}\n`);
      },
      dim() {},
    },
    ctx: {
      cwd: root,
      env: testEnv(),
      stdout: io.stdout,
      runDeploy: async () => 0,
      describeStackOutputs: () => ({
        AdminRepoCloneUrl: CLONE,
        WebAppDefaultDomain: ADMIN,
      }),
      pushAdminSource: async (spec) => {
        pushes.push(spec);
        return { ok: true, pushed: true };
      },
    },
    stackRoot: root,
    space: { stackName: "Context101Stack", namePrefix: "context101", region: "us-west-2" },
    env: testEnv(),
    envFile: path.join(root, "cdk", ".deploy-env"),
    exec: fakeExec(),
    dockerDaemon: true,
  });

  assert.equal(code, 0);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].cloneUrl, CLONE);
  assert.equal(pushes[0].stackRoot, root);
  assert.equal(io.stdoutText.includes("ghp_"), false);
  assert.equal(io.stderrText.includes("ghp_"), false);
});

test("startDeploy does not push when REPOSITORY overrides to GitHub", async () => {
  const root = await adminFixture();
  await writeTestDeployEnv(
    root,
    ['CTX_GH_TOKEN="ghp_testtoken_xx"', 'REPOSITORY="https://github.com/acme/context101"'].join("\n")
  );
  const io = memoryIo();
  const pushes = [];

  const code = await startDeploy({
    io: {
      write(line) {
        io.stdout.write(`${line}\n`);
      },
      ok(msg) {
        io.stdout.write(`${msg}\n`);
      },
      warn(msg) {
        io.stderr.write(`${msg}\n`);
      },
      err(msg) {
        io.stderr.write(`${msg}\n`);
      },
      dim() {},
    },
    ctx: {
      cwd: root,
      env: testEnv(),
      stdout: io.stdout,
      runDeploy: async () => 0,
      describeStackOutputs: () => ({
        AdminRepoCloneUrl: CLONE,
        WebAppDefaultDomain: ADMIN,
      }),
      pushAdminSource: async (spec) => {
        pushes.push(spec);
        return { ok: true, pushed: true };
      },
    },
    stackRoot: root,
    space: { stackName: "Context101Stack", namePrefix: "context101" },
    env: testEnv(),
    envFile: path.join(root, "cdk", ".deploy-env"),
    exec: fakeExec(),
    dockerDaemon: true,
  });

  assert.equal(code, 0);
  assert.equal(pushes.length, 0);
});
