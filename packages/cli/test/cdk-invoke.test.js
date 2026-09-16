import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertDeployTokens,
  buildCdkArgs,
  formatCdkPreview,
  resolveDeployContext,
} from "../src/cdk-invoke.js";
import { makeRepoFixture } from "./helpers.js";

async function contextFromFile(root, lines, env = {}) {
  await writeFile(path.join(root, "cdk", ".deploy-env"), `${lines.join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return resolveDeployContext({ repoRoot: root, env });
}

test("refuses deploy without CTX_TOKEN", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-cdk-notoken-"));
  await makeRepoFixture(root);
  const context = resolveDeployContext({ repoRoot: root, env: {} });
  assert.throws(() => assertDeployTokens(context, { action: "deploy" }), /CTX_TOKEN/);
  assert.doesNotThrow(() => assertDeployTokens(context, { action: "destroy" }));
});

test("does not forward ambient BETTER_AUTH_URL when an env file is loaded", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-cdk-ambient-"));
  await makeRepoFixture(root);
  const context = await contextFromFile(root, [
    'CTX_TOKEN="ctx_testtoken_xx"',
    'CTX_GH_TOKEN="ghp_testtoken_xx"',
    'DATABASE_URL="postgresql://user:file-secret@db.example/app"',
    'APP_MODE="self_hosted"',
  ]);
  const args = buildCdkArgs({
    action: "deploy",
    context,
    env: {
      BETTER_AUTH_URL: "https://hosted.example.test",
      APP_URL: "https://hosted.example.test",
      MARKETING_URL: "https://www.example.test",
      MCP_PUBLIC_HOST: "https://mcp.example.test",
    },
  });
  const joined = args.join(" ");
  assert.equal(joined.includes("hosted.example.test"), false);
  assert.equal(joined.includes("mcp.example.test"), false);
  assert.equal(joined.includes("BETTER_AUTH_URL"), false);
  assert.equal(joined.includes("MARKETING_URL"), false);
  assert.equal(joined.includes("www.example.test"), false);
  assert.match(joined, /DATABASE_URL=postgresql:\/\/user:file-secret@db.example\/app/);
  assert.match(joined, /APP_MODE=self_hosted/);
  const preview = formatCdkPreview({ action: "deploy", context, args });
  assert.equal(preview.includes("file-secret"), false);
  assert.equal(preview.includes("ctx_testtoken_xx"), false);
});

test("refuses a hosted product URL written in the env file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-cdk-hosted-"));
  await makeRepoFixture(root);
  const hosted = `https://app.${["context", "101"].join("")}.dev`;
  const context = await contextFromFile(root, [
    'CTX_TOKEN="ctx_testtoken_xx"',
    `BETTER_AUTH_URL="${hosted}"`,
  ]);
  assert.throws(() => buildCdkArgs({ action: "deploy", context }), /hosted Context101 product/);
});

test("forwards hosted product URLs when APP_MODE=hosted", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-cdk-hosted-ok-"));
  await makeRepoFixture(root);
  const zone = ["context", "101", ".", "dev"].join("");
  const appUrl = `https://app.${zone}`;
  const marketing = `https://${zone}`;
  const mcp = `https://mcp.${zone}`;
  const context = await contextFromFile(root, [
    'CTX_TOKEN="ctx_testtoken_xx"',
    'APP_MODE="hosted"',
    `BETTER_AUTH_URL="${appUrl}"`,
    `APP_URL="${appUrl}"`,
    `MARKETING_URL="${marketing}"`,
    `MCP_PUBLIC_HOST="${mcp}"`,
  ]);
  const args = buildCdkArgs({ action: "deploy", context });
  const joined = args.join(" ");
  assert.match(joined, new RegExp(`BETTER_AUTH_URL=${appUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(joined, new RegExp(`APP_URL=${appUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.equal(joined.includes("MARKETING_URL"), false);
  assert.equal(joined.includes(marketing), false);
  assert.match(joined, new RegExp(`MCP_PUBLIC_HOST=${mcp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(joined, /APP_MODE=hosted/);
});

test("deploys without githubToken on the CodeCommit path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-cdk-skipgh-"));
  await makeRepoFixture(root);
  const context = await contextFromFile(root, [
    'CTX_TOKEN="ctx_testtoken_xx"',
    'APP_MODE="self_hosted"',
  ]);
  assert.doesNotThrow(() => assertDeployTokens(context, { action: "deploy" }));
  const args = buildCdkArgs({ action: "deploy", context });
  const joined = args.join(" ");
  assert.match(joined, /token=ctx_testtoken_xx/);
  assert.equal(joined.includes("githubToken="), false);
});

test("rejects a ghs_ token when Amplify watches a repo", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-cdk-ghs-"));
  await makeRepoFixture(root);
  const context = await contextFromFile(root, [
    'CTX_TOKEN="ctx_testtoken_xx"',
    'CTX_GH_TOKEN="ghs_not_a_pat_token"',
    'REPOSITORY="https://github.com/acme/context101"',
  ]);
  assert.throws(
    () => assertDeployTokens(context, { action: "deploy" }),
    /personal access token|ghs_/
  );
});

test("forwards CREATE_RDS and EMBED_MODEL_ID / githubToken", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-cdk-fwd-"));
  await makeRepoFixture(root);
  const rds = await contextFromFile(root, [
    'CTX_TOKEN="ctx_testtoken_xx"',
    'CREATE_RDS="true"',
    'DATABASE_DRIVER="postgres-js"',
  ]);
  const rdsArgs = buildCdkArgs({ action: "deploy", context: rds }).join(" ");
  assert.match(rdsArgs, /CREATE_RDS=true/);
  assert.equal(rdsArgs.includes("DATABASE_URL="), false);

  const watch = await contextFromFile(root, [
    'CTX_TOKEN="ctx_testtoken_xx"',
    'CTX_GH_TOKEN="ghp_testtoken_xx"',
    'REPOSITORY="https://github.com/acme/context101"',
    'EMBED_MODEL_ID="amazon.titan-embed-text-v1"',
  ]);
  assert.doesNotThrow(() => assertDeployTokens(watch, { action: "deploy" }));
  const watchArgs = buildCdkArgs({ action: "deploy", context: watch }).join(" ");
  assert.match(watchArgs, /githubToken=ghp_testtoken_xx/);
  assert.match(watchArgs, /REPOSITORY=https:\/\/github.com\/acme\/context101/);
  assert.match(watchArgs, /EMBED_MODEL_ID=amazon.titan-embed-text-v1/);
});

test("env CTX_TOKEN wins over the file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-cdk-win-"));
  await makeRepoFixture(root);
  const context = await contextFromFile(
    root,
    ['CTX_TOKEN="ctx_filetoken_xx"'],
    { CTX_TOKEN: "ctx_envtoken_xx" }
  );
  assert.equal(context.token, "ctx_envtoken_xx");
});

test("buildCdkArgs can send --output outside the stack tree", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-cdk-outarg-"));
  await makeRepoFixture(root);
  const context = await contextFromFile(root, ['CTX_TOKEN="ctx_testtoken_xx"']);
  const outputDir = `${root}.cdk.out`;
  const args = buildCdkArgs({ action: "deploy", context, outputDir });
  const idx = args.indexOf("--output");
  assert.notEqual(idx, -1);
  assert.equal(args[idx + 1], outputDir);
  assert.equal(outputDir.startsWith(root + "/"), false);
});
