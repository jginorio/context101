import assert from "node:assert/strict";
import { test } from "node:test";
import { helpText, parseArgs } from "../src/parse-args.js";

test("defaults to init with no args", () => {
  const opts = parseArgs([]);
  assert.equal(opts.command, "init");
  assert.equal(opts.dryRun, false);
  assert.equal(opts.yes, false);
  assert.equal(opts.deploy, false);
});

test("parses init flags", () => {
  const opts = parseArgs([
    "init",
    "--dry-run",
    "--yes",
    "--seed",
    "--database-url",
    "postgresql://x",
    "--create-rds",
    "--database-driver",
    "postgres-js",
    "--database-prepare",
    "false",
    "--repo",
    "https://github.com/acme/context101",
    "--embed-model",
    "amazon.titan-embed-text-v1",
    "--deploy-env",
    "/tmp/deploy-env",
    "--aws-profile",
    "findit",
    "--aws-access-key-id",
    "TESTACCESSKEYID12345",
    "--aws-secret-access-key",
    "test-secret-access-key-must-never-appear",
  ]);
  assert.equal(opts.dryRun, true);
  assert.equal(opts.yes, true);
  assert.equal(opts.seed, true);
  assert.equal(opts.databaseUrl, "postgresql://x");
  assert.equal(opts.createRds, true);
  assert.equal(opts.databaseDriver, "postgres-js");
  assert.equal(opts.databasePrepare, false);
  assert.equal(opts.repo, "https://github.com/acme/context101");
  assert.equal(opts.embedModel, "amazon.titan-embed-text-v1");
  assert.equal(opts.envFile, "/tmp/deploy-env");
  assert.equal(opts.awsProfile, "findit");
  assert.equal(opts.awsAccessKeyId, "TESTACCESSKEYID12345");
  assert.equal(opts.awsSecretAccessKey, "test-secret-access-key-must-never-appear");
});

test("help text says --aws-profile is required with --yes when several exist", () => {
  assert.match(helpText(), /required with --yes/);
  assert.match(helpText(), /skip Amplify/);
  assert.match(helpText(), /embed-model/);
  assert.match(helpText(), /create-rds|creates RDS/);
});

test("rejects unknown command and flag", () => {
  assert.throws(() => parseArgs(["site"]), /unknown command/);
  assert.throws(() => parseArgs(["init", "--billing"]), /unknown flag/);
});

test("help text names init and deploy.sh, not site/", () => {
  const text = helpText();
  assert.match(text, /npx context101 init/);
  assert.match(text, /npm run context101 -- init/);
  assert.match(text, /Context7/);
  assert.match(text, /deploy\.sh/);
  assert.equal(text.includes("site/"), false);
});

test("workspace package is named context101 so npx does not fetch Context7", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  assert.equal(pkg.name, "context101");
  assert.equal(pkg.bin.context101, "./bin/context101.js");
});
