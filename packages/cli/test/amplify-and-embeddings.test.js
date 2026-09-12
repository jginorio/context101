import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  AMPLIFY_OWNER_LOGIN,
  defaultAmplifyRepository,
} from "../src/amplify-repo.js";
import { DEFAULT_AMPLIFY_REPO } from "../src/defaults.js";
import {
  allEmbeddingModels,
  catalogEntry,
  isKnownEmbeddingModel,
  parseEmbeddingCatalog,
} from "../src/embedding-models.js";
import { renderDeployEnv } from "../src/env-file.js";
import { createRequire } from "node:module";
import { main } from "../src/main.js";
import { fakeExec, makeRepoFixture, memoryIo, testEnv } from "./helpers.js";

const require = createRequire(import.meta.url);
const { isNeonConnectionString } = require(
  "../../../cdk/layers/pg-http/nodejs/node_modules/pg-http/index.js"
);

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

test("Amplify defaults to skip unless gh login is the repo owner", () => {
  assert.equal(defaultAmplifyRepository({ ghLogin: "acme-user" }), "");
  assert.equal(defaultAmplifyRepository({}), "");
  assert.equal(
    defaultAmplifyRepository({ ghLogin: AMPLIFY_OWNER_LOGIN }),
    DEFAULT_AMPLIFY_REPO
  );
  assert.equal(
    defaultAmplifyRepository({
      repo: "https://github.com/acme/context101",
      ghLogin: "acme-user",
    }),
    "https://github.com/acme/context101"
  );
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
  await makeRepoFixture(root);
  const io = memoryIo();
  const envPath = path.join(root, "cdk", ".deploy-env");

  const code = await main(
    ["init", "--yes", "--database-url", "postgresql://localhost/db", "--force"],
    {
      cwd: root,
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
  assert.match(io.stdoutText, /Amplify is skipped/);
});

test("--yes watches the default repo when gh login is the owner", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-owner-amp-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const envPath = path.join(root, "cdk", ".deploy-env");

  const code = await main(
    ["init", "--yes", "--database-url", "postgresql://localhost/db", "--force"],
    {
      cwd: root,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec({
        "gh api user --jq .login": {
          ok: true,
          code: 0,
          stdout: `${AMPLIFY_OWNER_LOGIN}\n`,
          stderr: "",
          error: null,
        },
      }),
    }
  );

  assert.equal(code, 0);
  const body = await readFile(envPath, "utf8");
  assert.match(body, new RegExp(`REPOSITORY="${DEFAULT_AMPLIFY_REPO}"`));
  assert.match(io.stdoutText, /WebAppDefaultDomain|\/setup/);
});

test("--yes --repo writes that repo and --embed-model writes the id", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-repo-embed-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const envPath = path.join(root, "cdk", ".deploy-env");

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

test("--yes --deploy with a ghs_ token still deploys when Amplify is skipped", async () => {
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
