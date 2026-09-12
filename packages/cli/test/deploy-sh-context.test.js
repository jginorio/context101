import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const deployShSrc = path.resolve(import.meta.dirname, "../../../cdk/deploy.sh");

async function setupWrapperHome() {
  const dir = await mkdtemp(path.join(tmpdir(), "ctx101-wrap-"));
  await copyFile(deployShSrc, path.join(dir, "deploy.sh"));
  await chmod(path.join(dir, "deploy.sh"), 0o755);
  const bin = path.join(dir, "bin");
  await mkdir(bin);
  await writeFile(
    path.join(bin, "npx"),
    `#!/bin/sh\nprintf '%s\\0' "$@" > "${dir}/npx-args"\n`,
    { mode: 0o755 }
  );
  return dir;
}

function runWrapper(dir, extraEnv) {
  return spawnSync("bash", [path.join(dir, "deploy.sh")], {
    cwd: dir,
    env: {
      PATH: `${path.join(dir, "bin")}:/usr/bin:/bin`,
      HOME: dir,
      NO_COLOR: "1",
      ...extraEnv,
    },
    encoding: "utf8",
  });
}

test("deploy.sh rejects ghs_ before calling cdk when Amplify watches a repo", async () => {
  const dir = await setupWrapperHome();
  await writeFile(
    path.join(dir, ".deploy-env"),
    [
      'CTX_TOKEN="ctx_testtoken_xx"',
      'CTX_GH_TOKEN="ghs_not_a_pat_token"',
      'REPOSITORY="https://github.com/acme/context101"',
      "",
    ].join("\n"),
    { mode: 0o600 }
  );

  const result = runWrapper(dir, {});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not a personal access token|ghs_/);
  let npxWrote = false;
  try {
    await readFile(path.join(dir, "npx-args"));
    npxWrote = true;
  } catch {
    npxWrote = false;
  }
  assert.equal(npxWrote, false);
});

test("deploy.sh does not forward ambient BETTER_AUTH_URL", async () => {
  const dir = await setupWrapperHome();
  await writeFile(
    path.join(dir, ".deploy-env"),
    [
      'CTX_TOKEN="ctx_testtoken_xx"',
      'CTX_GH_TOKEN="ghp_testtoken_xx"',
      'DATABASE_URL="postgresql://user:file-secret@db.example/app"',
      'APP_MODE="self_hosted"',
      "",
    ].join("\n"),
    { mode: 0o600 }
  );

  const result = runWrapper(dir, {
    BETTER_AUTH_URL: "https://hosted.example.test",
    APP_URL: "https://hosted.example.test",
    MARKETING_URL: "https://www.example.test",
    MCP_PUBLIC_HOST: "https://mcp.example.test",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const raw = await readFile(path.join(dir, "npx-args"));
  const args = raw.toString("utf8").split("\0").filter(Boolean);
  const joined = args.join(" ");
  assert.equal(joined.includes("hosted.example.test"), false);
  assert.equal(joined.includes("mcp.example.test"), false);
  assert.equal(joined.includes("www.example.test"), false);
  assert.equal(joined.includes("BETTER_AUTH_URL"), false);
  assert.match(joined, /DATABASE_URL=postgresql:\/\/user:file-secret@db.example\/app/);
  assert.match(joined, /APP_MODE=self_hosted/);
  assert.equal(result.stdout.includes("https://hosted.example.test"), false);
  assert.equal(result.stdout.includes("file-secret"), false);
});

test("deploy.sh refuses a hosted product URL written in the env file", async () => {
  const dir = await setupWrapperHome();
  const hosted = `https://app.${["context", "101"].join("")}.dev`;
  await writeFile(
    path.join(dir, ".deploy-env"),
    [
      'CTX_TOKEN="ctx_testtoken_xx"',
      'CTX_GH_TOKEN="ghp_testtoken_xx"',
      `BETTER_AUTH_URL="${hosted}"`,
      "",
    ].join("\n"),
    { mode: 0o600 }
  );

  const result = runWrapper(dir, {});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /hosted Context101 product|Amplify default/i);
  let npxWrote = false;
  try {
    await readFile(path.join(dir, "npx-args"));
    npxWrote = true;
  } catch {
    npxWrote = false;
  }
  assert.equal(npxWrote, false);
});

test("deploy.sh deploys without CTX_GH_TOKEN when Amplify is skipped", async () => {
  const dir = await setupWrapperHome();
  await writeFile(
    path.join(dir, ".deploy-env"),
    ['CTX_TOKEN="ctx_testtoken_xx"', 'APP_MODE="self_hosted"', ""].join("\n"),
    { mode: 0o600 }
  );

  const result = runWrapper(dir, {});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const raw = await readFile(path.join(dir, "npx-args"));
  const joined = raw.toString("utf8");
  assert.match(joined, /token=ctx_testtoken_xx/);
  assert.equal(joined.includes("githubToken="), false);
  assert.match(result.stdout, /skipped — no REPOSITORY/);
});

test("deploy.sh ignores a ghs_ gh token when Amplify is skipped", async () => {
  const dir = await setupWrapperHome();
  await writeFile(
    path.join(dir, ".deploy-env"),
    [
      'CTX_TOKEN="ctx_testtoken_xx"',
      'CTX_GH_TOKEN="ghs_not_a_pat_token"',
      "",
    ].join("\n"),
    { mode: 0o600 }
  );

  const result = runWrapper(dir, {});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const raw = await readFile(path.join(dir, "npx-args"));
  assert.equal(raw.toString("utf8").includes("githubToken="), false);
});

test("deploy.sh forwards EMBED_MODEL_ID and githubToken when watching a repo", async () => {
  const dir = await setupWrapperHome();
  await writeFile(
    path.join(dir, ".deploy-env"),
    [
      'CTX_TOKEN="ctx_testtoken_xx"',
      'CTX_GH_TOKEN="ghp_testtoken_xx"',
      'REPOSITORY="https://github.com/acme/context101"',
      'EMBED_MODEL_ID="amazon.titan-embed-text-v1"',
      "",
    ].join("\n"),
    { mode: 0o600 }
  );

  const result = runWrapper(dir, {});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const raw = await readFile(path.join(dir, "npx-args"));
  const joined = raw.toString("utf8");
  assert.match(joined, /githubToken=ghp_testtoken_xx/);
  assert.match(joined, /REPOSITORY=https:\/\/github.com\/acme\/context101/);
  assert.match(joined, /EMBED_MODEL_ID=amazon.titan-embed-text-v1/);
});

test("deploy.sh never forwards an ambient hosted product URL", async () => {
  const dir = await setupWrapperHome();
  const hosted = `https://app.${["context", "101"].join("")}.dev`;
  await writeFile(
    path.join(dir, ".deploy-env"),
    [
      'CTX_TOKEN="ctx_testtoken_xx"',
      'CTX_GH_TOKEN="ghp_testtoken_xx"',
      'APP_MODE="self_hosted"',
      "",
    ].join("\n"),
    { mode: 0o600 }
  );

  const result = runWrapper(dir, {
    BETTER_AUTH_URL: hosted,
    APP_URL: hosted,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const raw = await readFile(path.join(dir, "npx-args"));
  const joined = raw.toString("utf8");
  assert.equal(joined.includes("BETTER_AUTH_URL"), false);
  assert.equal(joined.includes("APP_URL"), false);
  assert.equal(joined.includes(hosted), false);
});
