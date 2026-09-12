import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readExampleToken } from "../src/env-file.js";
import { main } from "../src/main.js";
import { collectSecrets } from "../src/redact.js";
import { findRepoRoot } from "../src/repo.js";
import { fakeExec, makeRepoFixture, memoryIo } from "./helpers.js";

test("--yes writes chmod 600 env and never prints secrets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-yes-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const secretUrl = "postgresql://user:yes-secret-db@localhost/app";
  const envPath = path.join(root, "tmp-deploy-env");
  let deployed = false;

  const code = await main(
    [
      "init",
      "--yes",
      "--database-url",
      secretUrl,
      "--env-file",
      envPath,
      "--aws-profile",
      "dev",
    ],
    {
      cwd: root,
      env: { ...process.env, NO_COLOR: "1" },
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
  assert.equal(existsSync(envPath), true);
  const st = await stat(envPath);
  assert.equal(st.mode & 0o777, 0o600);

  const body = await readFile(envPath, "utf8");
  assert.match(body, /^CTX_TOKEN="/m);
  assert.match(body, /^BETTER_AUTH_SECRET="/m);
  assert.match(body, /^MCP_TOKEN_PEPPER="/m);
  assert.match(body, /^DATABASE_URL="/m);
  assert.match(body, /DATABASE_DRIVER="postgres-js"/);
  assert.match(body, /APP_MODE="self_hosted"/);
  assert.match(body, /ALLOW_PUBLIC_SIGNUP="false"/);
  assert.match(body, /BILLING_ENABLED="false"/);
  assert.match(body, /AWS_PROFILE="dev"/);
  assert.equal(body.includes("example-do-not-copy"), false);
  assert.equal(body.includes("site/"), false);

  const token = body.match(/^CTX_TOKEN="([^"]+)"/m)[1];
  const fixtureExample = await readExampleToken(
    path.join(root, "cdk", ".deploy-env.example")
  );
  assert.notEqual(token, fixtureExample);
  const checkout = findRepoRoot(import.meta.dirname);
  if (checkout) {
    const repoExample = await readExampleToken(
      path.join(checkout, "cdk", ".deploy-env.example")
    );
    if (repoExample) assert.notEqual(token, repoExample);
  }
  const auth = body.match(/^BETTER_AUTH_SECRET="([^"]+)"/m)[1];
  const pepper = body.match(/^MCP_TOKEN_PEPPER="([^"]+)"/m)[1];
  const secrets = collectSecrets({
    CTX_TOKEN: token,
    BETTER_AUTH_SECRET: auth,
    MCP_TOKEN_PEPPER: pepper,
    DATABASE_URL: secretUrl,
  });

  const text = `${io.stdoutText}\n${io.stderrText}`;
  for (const secret of secrets) {
    assert.equal(text.includes(secret), false, "stdout leaked a secret");
  }
  assert.equal(text.includes("gho_test_token_must_never_appear"), false);
  assert.match(text, /wrote tmp-deploy-env/);
  assert.match(text, /\.\/cdk\/deploy\.sh/);
  assert.match(text, /\/setup/);
  assert.equal(text.includes("site/"), false);
  assert.equal(deployed, false);
});

test("--yes refuses to overwrite without --force", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-ow-"));
  await makeRepoFixture(root);
  const envPath = path.join(root, "cdk", ".deploy-env");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(envPath, "CTX_TOKEN=keep-me\n", "utf8");
  const io = memoryIo();

  const code = await main(
    ["init", "--yes", "--database-url", "postgresql://localhost/db"],
    {
      cwd: root,
      env: { ...process.env, NO_COLOR: "1" },
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec(),
    }
  );

  assert.equal(code, 1);
  assert.match(io.stderrText, /already exists/);
  const body = await readFile(envPath, "utf8");
  assert.equal(body, "CTX_TOKEN=keep-me\n");
});

test("--yes without a database URL fails", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-nodb-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const env = { ...process.env, NO_COLOR: "1" };
  delete env.DATABASE_URL;

  const code = await main(["init", "--yes"], {
    cwd: root,
    env,
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(),
  });

  assert.equal(code, 1);
  assert.match(io.stderrText, /Postgres URL/);
  assert.equal(existsSync(path.join(root, "cdk", ".deploy-env")), false);
});
