import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  inferDriver,
  inferPrepare,
  quoteShell,
  renderDeployEnv,
  writeDeployEnv,
} from "../src/env-file.js";
import { DRIVER_NEON, DRIVER_POSTGRES, SMOOTH_REGION } from "../src/defaults.js";
import { outputContainsSecret } from "../src/redact.js";

test("infers the Neon driver from neon.tech URLs", () => {
  assert.equal(inferDriver("postgresql://user@ep-x.neon.tech/db"), DRIVER_NEON);
  assert.equal(inferDriver("postgresql://localhost/db"), DRIVER_POSTGRES);
});

test("disables prepare for Supabase pooler URLs", () => {
  assert.equal(inferPrepare("postgresql://x.pooler.supabase.com/postgres"), false);
  assert.equal(inferPrepare("postgresql://localhost/db"), true);
});

test("quoteShell escapes interpolation", () => {
  assert.equal(quoteShell('a"b'), '"a\\"b"');
  assert.equal(quoteShell("a$b"), '"a\\$b"');
});

test("writer uses generated secrets and never the example token", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ctx101-env-"));
  const filePath = path.join(dir, ".deploy-env");
  const values = {
    CTX_TOKEN: "generated-ctx-token-value",
    BETTER_AUTH_SECRET: "generated-auth-secret-value",
    MCP_TOKEN_PEPPER: "generated-pepper-value",
    DATABASE_URL: "postgresql://user:super-secret-db@localhost/db",
    DATABASE_DRIVER: "postgres-js",
    DATABASE_PREPARE: true,
    APP_MODE: "self_hosted",
    ALLOW_PUBLIC_SIGNUP: "false",
    BILLING_ENABLED: "false",
    REPOSITORY: "https://github.com/acme/context101",
    AWS_REGION: SMOOTH_REGION,
  };

  await writeDeployEnv(filePath, values);
  const st = await stat(filePath);
  assert.equal(st.mode & 0o777, 0o600);

  const body = await readFile(filePath, "utf8");
  assert.match(body, /CTX_TOKEN="generated-ctx-token-value"/);
  assert.match(body, /APP_MODE="self_hosted"/);
  assert.match(body, /ALLOW_PUBLIC_SIGNUP="false"/);
  assert.match(body, /BILLING_ENABLED="false"/);
  assert.match(body, /REPOSITORY="https:\/\/github.com\/acme\/context101"/);
  assert.equal(body.includes("example-do-not-copy"), false);
  assert.equal(body.includes("site/"), false);
  assert.match(body, /never raw `cdk deploy`/);
  assert.match(body, /amplifyapp\.com/);
  assert.equal(body.includes("BETTER_AUTH_URL="), false);
  assert.equal(body.includes("APP_URL="), false);

  const snapshot = renderDeployEnv({
    ...values,
    CTX_TOKEN: "redacted-in-snapshot",
    BETTER_AUTH_SECRET: "redacted-in-snapshot",
    MCP_TOKEN_PEPPER: "redacted-in-snapshot",
    DATABASE_URL: "redacted-in-snapshot",
  });
  assert.equal(
    outputContainsSecret(snapshot, [
      "generated-ctx-token-value",
      "generated-auth-secret-value",
      "generated-pepper-value",
      "postgresql://user:super-secret-db@localhost/db",
    ]),
    false
  );
});

test("writer drops hosted product URLs instead of copying them", () => {
  const hosted = `https://app.${["context", "101"].join("")}.dev`;
  const body = renderDeployEnv({
    CTX_TOKEN: "generated-ctx-token-value",
    BETTER_AUTH_SECRET: "generated-auth-secret-value",
    MCP_TOKEN_PEPPER: "generated-pepper-value",
    DATABASE_URL: "postgresql://localhost/db",
    DATABASE_DRIVER: "postgres-js",
    DATABASE_PREPARE: true,
    BETTER_AUTH_URL: hosted,
    APP_URL: hosted,
  });
  assert.equal(body.includes(hosted), false);
  assert.equal(body.includes("BETTER_AUTH_URL="), false);
  assert.equal(body.includes("APP_URL="), false);
  assert.match(body, /amplifyapp\.com/);
});
