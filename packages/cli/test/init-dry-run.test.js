import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../src/main.js";
import { DRIVER_NEON } from "../src/defaults.js";
import { fakeExec, makeRepoFixture, memoryIo } from "./helpers.js";

test("dry-run prints the plan and writes nothing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-dry-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const secretUrl = "postgresql://user:dry-run-secret-db@db.neon.tech/app";
  let deployed = false;

  const code = await main(
    ["init", "--dry-run", "--database-url", secretUrl, "--seed"],
    {
      cwd: root,
      env: { ...process.env, NO_COLOR: "1", DATABASE_URL: "" },
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
  const text = `${io.stdoutText}\n${io.stderrText}`;
  assert.match(text, /Context101/);
  assert.match(text, /dry-run/);
  assert.match(text, /Would write: cdk\/\.deploy-env/);
  assert.match(text, /Would not deploy/);
  assert.match(text, /\/setup/);
  assert.match(text, /deploy\.sh --seed/);
  assert.match(text, /https:\/\/github.com\/acme\/context101/);
  assert.match(text, new RegExp(DRIVER_NEON));
  assert.equal(text.includes(secretUrl), false);
  assert.equal(text.includes("dry-run-secret-db"), false);
  assert.equal(text.includes("gho_test_token_must_never_appear"), false);
  assert.equal(text.includes("site/"), false);
  assert.equal(text.includes("example-do-not-copy"), false);
  assert.equal(deployed, false);

  const { existsSync } = await import("node:fs");
  assert.equal(existsSync(path.join(root, "cdk", ".deploy-env")), false);
});
