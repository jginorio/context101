import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../src/main.js";
import { fakeExec, makeRepoFixture, memoryIo } from "./helpers.js";

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
      "--env-file",
      path.join(root, "cdk", ".deploy-env"),
    ],
    {
      cwd: root,
      env: { ...process.env, NO_COLOR: "1" },
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
