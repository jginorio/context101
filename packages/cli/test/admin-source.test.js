import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  ADMIN_GIT_TIMEOUT_MS,
  hasAdminSource,
  pushAdminSource,
  sanitizeAdminGitDetail,
  stageAdminSource,
} from "../src/admin-source.js";
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
    version: "0.1.20",
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
  const helperCalls = git.filter((c) => c.args.includes("credential.helper"));
  assert.equal(helperCalls.length, 2);
  assert.deepEqual(helperCalls[0].args, ["config", "--local", "credential.helper", ""]);
  assert.equal(helperCalls[0].args.includes("--add"), false);
  assert.deepEqual(helperCalls[1].args, [
    "config",
    "--local",
    "--add",
    "credential.helper",
    "!aws --region us-west-2 codecommit credential-helper $@",
  ]);
  const helperIdx = git.findIndex((c) => c.args.includes("credential.helper") && c.args.includes("--add"));
  const resetIdx = git.findIndex(
    (c) => c.args.includes("credential.helper") && c.args.includes("") && !c.args.includes("--add")
  );
  assert.ok(resetIdx >= 0 && helperIdx > resetIdx);
  const useHttp = git.find((c) => c.args.includes("credential.UseHttpPath"));
  assert.deepEqual(useHttp.args, ["config", "--local", "credential.UseHttpPath", "true"]);
  const push = git.find((c) => c.args[0] === "push");
  assert.ok(push);
  assert.deepEqual(push.args.slice(0, 3), ["push", "--force", "origin"]);
  for (const step of ["add", "commit", "push"]) {
    const call = git.find((c) => c.args[0] === step);
    assert.equal(call.timeout, ADMIN_GIT_TIMEOUT_MS);
  }
  assert.equal(git.find((c) => c.args[0] === "init").timeout, undefined);
  assert.ok(git.some((c) => c.args[0] === "remote" && c.args.includes(CLONE)));
  const joined = calls.map((c) => [c.command, ...(c.args || [])].join(" ")).join("\n");
  assert.equal(joined.includes("ghp_"), false);
  assert.equal(joined.includes("githubToken"), false);
});

test("pushAdminSource warns with the failing step and sanitized stderr", async () => {
  const root = await adminFixture();
  const warnings = [];
  const token = "ctx-token-value-should-not-leak";
  const result = pushAdminSource({
    stackRoot: root,
    cloneUrl: CLONE,
    version: "0.1.20",
    exec: (spec) => {
      if (spec.args?.[0] === "push") {
        return {
          ok: false,
          code: 128,
          stdout: "",
          stderr:
            "fatal: unable to access 'https://git-codecommit.us-west-2.amazonaws.com/v1/repos/context101-admin/': The requested URL returned error: 403\npassword=super-secret-git-password\nCTX_TOKEN=ctx-token-value-should-not-leak",
          error: null,
        };
      }
      return { ok: true, code: 0, stdout: "", stderr: "", error: null };
    },
    env: { CTX_TOKEN: token },
    region: "us-west-2",
    io: {
      warn(msg) {
        warnings.push(msg);
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.step, "push");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /git push/);
  assert.match(warnings[0], /403/);
  assert.match(warnings[0], /Amplify will build once web\/ is on CodeCommit/);
  assert.equal(warnings[0].includes("super-secret-git-password"), false);
  assert.equal(warnings[0].includes(token), false);
  assert.equal(warnings[0].includes("password=…"), true);
});

test("empty helper then --add keeps the reset in .git/config", async () => {
  const root = await adminFixture();
  const calls = [];
  pushAdminSource({
    stackRoot: root,
    cloneUrl: CLONE,
    exec: (spec) => {
      calls.push(spec);
      return { ok: true, code: 0, stdout: "", stderr: "", error: null };
    },
    env: testEnv(),
    region: "us-west-2",
  });
  const helperSteps = calls
    .filter((c) => c.command === "git" && c.args[0] === "config" && c.args.includes("credential.helper"))
    .map((c) => c.args);
  assert.equal(helperSteps.length, 2);
  assert.equal(helperSteps[0].includes("--add"), false);
  assert.equal(helperSteps[1].includes("--add"), true);

  const dest = await mkdtemp(path.join(tmpdir(), "ctx101-git-helper-"));
  const { createExec } = await import("../src/exec.js");
  const { readFile } = await import("node:fs/promises");
  const exec = createExec();
  const init = exec({ command: "git", args: ["init", "-b", "main"], cwd: dest });
  assert.equal(init.ok, true, init.stderr || init.error?.message);
  for (const args of helperSteps) {
    const result = exec({ command: "git", args, cwd: dest });
    assert.equal(result.ok, true, result.stderr || result.error?.message);
  }
  const cfg = await readFile(path.join(dest, ".git", "config"), "utf8");
  assert.match(cfg, /helper =\s*\n\thelper = !aws --region us-west-2 codecommit credential-helper \$@/);

  const replaceDest = await mkdtemp(path.join(tmpdir(), "ctx101-git-replace-"));
  assert.equal(exec({ command: "git", args: ["init", "-b", "main"], cwd: replaceDest }).ok, true);
  assert.equal(
    exec({ command: "git", args: ["config", "--local", "credential.helper", ""], cwd: replaceDest }).ok,
    true
  );
  assert.equal(
    exec({
      command: "git",
      args: [
        "config",
        "--local",
        "credential.helper",
        "!aws --region us-west-2 codecommit credential-helper $@",
      ],
      cwd: replaceDest,
    }).ok,
    true
  );
  const replaced = await readFile(path.join(replaceDest, ".git", "config"), "utf8");
  assert.equal(/\thelper =\s*\n/.test(replaced), false);
});

test("sanitizeAdminGitDetail strips passwords and env secrets", () => {
  const text = sanitizeAdminGitDetail(
    "fatal: 403\npassword=leaked-git-password\nhttps://aws:leakedpass@git-codecommit.example/v1/repos/x",
    { CTX_TOKEN: "leaked-ctx-token-xx", AWS_SECRET_ACCESS_KEY: "leaked-secret-key-xx" }
  );
  assert.equal(text.includes("leaked-git-password"), false);
  assert.equal(text.includes("leakedpass"), false);
  assert.equal(text.includes("leaked-ctx-token-xx"), false);
  assert.equal(text.includes("leaked-secret-key-xx"), false);
  assert.match(text, /403/);
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
