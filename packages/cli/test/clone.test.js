import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { CLONE_URL, ensureRepoRoot } from "../src/clone.js";
import { main } from "../src/main.js";
import { fakeExec, makeRepoFixture, memoryIo, testEnv } from "./helpers.js";

function mockClone(dest) {
  mkdirSync(path.join(dest, "cdk"), { recursive: true });
  mkdirSync(path.join(dest, "web"), { recursive: true });
  writeFileSync(path.join(dest, "cdk", "cdk.json"), "{}\n");
  writeFileSync(path.join(dest, "web", "package.json"), '{"name":"web"}\n');
}

test("ensureRepoRoot clones when cwd is not a checkout", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-empty-"));
  const io = memoryIo();
  const result = ensureRepoRoot({
    cwd,
    exec: ({ command, args }) => {
      assert.equal(command, "git");
      assert.equal(args[0], "clone");
      assert.equal(args[1], "--depth");
      assert.equal(args[3], CLONE_URL);
      mockClone(args[4]);
      return { ok: true, code: 0, stdout: "", stderr: "", error: null };
    },
    io,
  });
  assert.equal(result.cloned, true);
  assert.equal(result.repoRoot, path.join(cwd, "context101"));
});

test("init --dry-run clones in the plan when not in a checkout", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-init-clone-"));
  const io = memoryIo();
  const code = await main(["init", "--dry-run", "--dir", "my-stack"], {
    cwd,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(),
  });
  assert.equal(code, 0);
  assert.match(io.stdoutText, /Would clone/);
  assert.match(io.stdoutText, /my-stack/);
  assert.equal(io.stdoutText.includes("deploy.sh"), false);
});

test("init clones then writes deploy-env when mocked", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-init-git-"));
  const io = memoryIo();
  const dest = path.join(cwd, "context101");
  const code = await main(["init", "--yes", "--force"], {
    cwd,
    env: testEnv({
      AWS_ACCESS_KEY_ID: "TESTACCESSKEYID12345",
      AWS_SECRET_ACCESS_KEY: "test-secret-access-key-must-never-appear",
    }),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: (spec) => {
      if (spec.command === "git" && spec.args?.[0] === "clone") {
        mockClone(spec.args[spec.args.length - 1]);
        return { ok: true, code: 0, stdout: "", stderr: "", error: null };
      }
      return fakeExec()(spec);
    },
  });
  assert.equal(code, 0);
  const { existsSync } = await import("node:fs");
  assert.equal(existsSync(path.join(dest, "cdk", ".deploy-env")), true);
  assert.match(io.stdoutText, /cloned into context101/);
});
