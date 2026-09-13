import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { defaultAmplifyRepository } from "../src/amplify-repo.js";
import {
  allEmbeddingModels,
  catalogEntry,
  isKnownEmbeddingModel,
  parseEmbeddingCatalog,
} from "../src/embedding-models.js";
import { renderDeployEnv } from "../src/env-file.js";
import { createRequire } from "node:module";
import { main } from "./run-main.js";
import { DEFAULT_SPACE, defaultSpaceEnvPath } from "../src/spaces.js";
import { fakeExec, makeRepoFixture, memoryIo, tempHome, testEnv } from "./helpers.js";

const require = createRequire(import.meta.url);
const {
  isNeonConnectionString,
  sslOptionForTcp,
  tcpClientConfig,
} = require("../../../cdk/layers/pg-http/nodejs/pg-http/index.js");

test("pg-http treats Neon hosts as HTTP and RDS as TCP", () => {
  assert.equal(
    isNeonConnectionString("postgresql://u:p@ep-x.neon.tech/db"),
    true
  );
  assert.equal(
    isNeonConnectionString("postgresql://u:p@context101.xxxx.rds.amazonaws.com/context101"),
    false
  );
});

test("pg-http does not verify certs for RDS sslmode=require", () => {
  const url =
    "postgresql://u:p@context101.xxxx.rds.amazonaws.com/context101?sslmode=require";
  assert.deepEqual(sslOptionForTcp(url), { rejectUnauthorized: false });
  const config = tcpClientConfig(url);
  assert.deepEqual(config.ssl, { rejectUnauthorized: false });
  assert.equal(/sslmode=/i.test(config.connectionString), false);
});

test("Amplify defaults to CodeCommit (no GitHub watch target)", () => {
  assert.equal(defaultAmplifyRepository(), "");
  assert.equal(defaultAmplifyRepository({}), "");
  assert.equal(defaultAmplifyRepository({ ghLogin: "jginorio" }), "");
  assert.equal(
    defaultAmplifyRepository({
      repo: "https://github.com/acme/context101",
    }),
    "https://github.com/acme/context101"
  );
});

test("embedding catalog includes new Titan/Cohere ids and drops SKU variants", () => {
  const models = parseEmbeddingCatalog({
    modelSummaries: [
      {
        modelId: "cohere.embed-v4",
        providerName: "Cohere",
        modelName: "Embed v4",
        modelLifecycle: { status: "ACTIVE" },
      },
      {
        modelId: "amazon.titan-embed-text-v3:0",
        providerName: "Amazon",
        modelName: "Titan Text Embeddings V3",
        modelLifecycle: { status: "ACTIVE" },
      },
      {
        modelId: "cohere.embed-v4:0:512",
        providerName: "Cohere",
        modelLifecycle: { status: "ACTIVE" },
      },
    ],
  });
  assert.deepEqual(
    models.map((m) => m.id),
    ["amazon.titan-embed-text-v3:0", "cohere.embed-v4"]
  );
  assert.equal(models.find((m) => m.id === "cohere.embed-v4").label, "Embed v4");
  const union = allEmbeddingModels(models);
  assert.equal(union.some((m) => m.id === "cohere.embed-v4"), true);
  assert.equal(union.some((m) => m.id === "amazon.titan-embed-text-v2:0"), true);
  assert.equal(union.some((m) => m.id === "cohere.embed-v4:0:512"), false);
});

test("embedding catalog keeps Titan/Cohere base ids and drops SKU variants", () => {
  const models = parseEmbeddingCatalog({
    modelSummaries: [
      {
        modelId: "amazon.titan-embed-text-v2:0",
        providerName: "Amazon",
        modelLifecycle: { status: "ACTIVE" },
      },
      {
        modelId: "cohere.embed-english-v3",
        providerName: "Cohere",
        modelLifecycle: { status: "ACTIVE" },
      },
      {
        modelId: "cohere.embed-multilingual-v3:0:512",
        providerName: "Cohere",
        modelLifecycle: { status: "ACTIVE" },
      },
      {
        modelId: "amazon.titan-embed-text-v2:0:8k",
        providerName: "Amazon",
        modelLifecycle: { status: "ACTIVE" },
      },
    ],
  });
  assert.deepEqual(
    models.map((m) => m.id),
    ["amazon.titan-embed-text-v2:0", "cohere.embed-english-v3"]
  );
  assert.equal(isKnownEmbeddingModel("amazon.titan-embed-text-v1"), true);
  assert.equal(isKnownEmbeddingModel("cohere.embed-multilingual-v3:0:512"), false);
});

test("allEmbeddingModels unions every curated id brains can pick later", () => {
  const models = allEmbeddingModels([catalogEntry("cohere.embed-english-v3")]);
  const ids = models.map((model) => model.id);
  assert.equal(ids.includes("amazon.titan-embed-text-v2:0"), true);
  assert.equal(ids.includes("amazon.titan-embed-text-v1"), true);
  assert.equal(ids.includes("amazon.titan-embed-image-v1"), true);
  assert.equal(ids.includes("cohere.embed-english-v3"), true);
  assert.equal(ids.includes("cohere.embed-multilingual-v3"), true);
  assert.equal(ids.includes("cohere.embed-english-light-v3"), true);
  assert.equal(ids.includes("cohere.embed-multilingual-light-v3"), true);
  assert.equal(ids.includes("cohere.embed-multilingual-v3:0:512"), false);
});

test("writer omits REPOSITORY and records EMBED_MODEL_ID when set", () => {
  const skipped = renderDeployEnv({
    CTX_TOKEN: "generated-ctx-token-value",
    BETTER_AUTH_SECRET: "generated-auth-secret-value",
    MCP_TOKEN_PEPPER: "generated-pepper-value",
    DATABASE_URL: "postgresql://localhost/db",
    DATABASE_DRIVER: "postgres-js",
    DATABASE_PREPARE: true,
  });
  assert.equal(skipped.includes("REPOSITORY="), false);
  assert.equal(skipped.includes("EMBED_MODEL_ID="), false);

  const chosen = renderDeployEnv({
    CTX_TOKEN: "generated-ctx-token-value",
    BETTER_AUTH_SECRET: "generated-auth-secret-value",
    MCP_TOKEN_PEPPER: "generated-pepper-value",
    DATABASE_URL: "postgresql://localhost/db",
    DATABASE_DRIVER: "postgres-js",
    DATABASE_PREPARE: true,
    EMBED_MODEL_ID: "amazon.titan-embed-text-v1",
  });
  assert.match(chosen, /EMBED_MODEL_ID="amazon\.titan-embed-text-v1"/);
});

test("--yes does not watch Amplify for a found-the-repo operator", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-skip-amp-"));
  const home = await tempHome();
  await makeRepoFixture(root);
  const io = memoryIo();
  const envPath = defaultSpaceEnvPath(DEFAULT_SPACE, home);

  const code = await main(
    ["init", "--yes", "--database-url", "postgresql://localhost/db", "--force"],
    {
      cwd: root,
      homeDir: home,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec(),
    }
  );

  assert.equal(code, 0);
  const body = await readFile(envPath, "utf8");
  assert.equal(body.includes("REPOSITORY="), false);
  assert.match(io.stdoutText, /spaces\/default\/deploy-env/);
  assert.match(io.stdoutText, /^context101 deploy$/m);
});

test("--yes never writes REPOSITORY even when gh login is the repo owner", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-owner-amp-"));
  const home = await tempHome();
  await makeRepoFixture(root);
  const io = memoryIo();
  const envPath = defaultSpaceEnvPath(DEFAULT_SPACE, home);

  const code = await main(
    ["init", "--yes", "--database-url", "postgresql://localhost/db", "--force"],
    {
      cwd: root,
      homeDir: home,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec({
        "gh api user --jq .login": {
          ok: true,
          code: 0,
          stdout: "jginorio\n",
          stderr: "",
          error: null,
        },
      }),
    }
  );

  assert.equal(code, 0);
  const body = await readFile(envPath, "utf8");
  assert.equal(body.includes("REPOSITORY="), false);
  assert.match(io.stdoutText, /spaces\/default\/deploy-env/);
  assert.match(io.stdoutText, /context101 deploy/);
});

test("--yes --repo writes that repo and --embed-model writes the id", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-repo-embed-"));
  const home = await tempHome();
  await makeRepoFixture(root);
  const io = memoryIo();
  const envPath = defaultSpaceEnvPath(DEFAULT_SPACE, home);

  const code = await main(
    [
      "init",
      "--yes",
      "--database-url",
      "postgresql://localhost/db",
      "--force",
      "--repo",
      "https://github.com/acme/context101",
      "--embed-model",
      "cohere.embed-english-v3",
    ],
    {
      cwd: root,
      homeDir: home,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec(),
    }
  );

  assert.equal(code, 0);
  const body = await readFile(envPath, "utf8");
  assert.match(body, /REPOSITORY="https:\/\/github.com\/acme\/context101"/);
  assert.match(body, /EMBED_MODEL_ID="cohere\.embed-english-v3"/);
});

test("--yes rejects an unknown embedding model", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-bad-embed-"));
  await makeRepoFixture(root);
  const io = memoryIo();

  const code = await main(
    [
      "init",
      "--yes",
      "--database-url",
      "postgresql://localhost/db",
      "--force",
      "--embed-model",
      "cohere.embed-multilingual-v3:0:512",
    ],
    {
      cwd: root,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec(),
    }
  );

  assert.equal(code, 1);
  assert.match(io.stderrText, /embed-model/);
  assert.equal(existsSync(path.join(root, "cdk", ".deploy-env")), false);
});

test("--yes --deploy with a ghs_ token still deploys on the CodeCommit path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-ghs-skip-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const calls = [];

  const code = await main(
    [
      "init",
      "--yes",
      "--deploy",
      "--database-url",
      "postgresql://localhost/db",
      "--force",
    ],
    {
      cwd: root,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec({
        "gh auth token": {
          ok: true,
          code: 0,
          stdout: "ghs_installation_must_never_appear",
          stderr: "",
          error: null,
        },
      }),
      runDeploy: async (spec) => {
        calls.push(spec);
        return 0;
      },
    }
  );

  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(io.stderrText.includes("ghs_installation_must_never_appear"), false);
});
