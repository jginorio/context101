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
    "--database-driver",
    "postgres-js",
    "--database-prepare",
    "false",
    "--repo",
    "https://github.com/acme/context101",
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
  assert.equal(opts.databaseDriver, "postgres-js");
  assert.equal(opts.databasePrepare, false);
  assert.equal(opts.repo, "https://github.com/acme/context101");
  assert.equal(opts.envFile, "/tmp/deploy-env");
  assert.equal(opts.awsProfile, "findit");
  assert.equal(opts.awsAccessKeyId, "TESTACCESSKEYID12345");
  assert.equal(opts.awsSecretAccessKey, "test-secret-access-key-must-never-appear");
});

test("help text says --aws-profile is required with --yes when several exist", () => {
  assert.match(helpText(), /required with --yes/);
});

test("rejects unknown command and flag", () => {
  assert.throws(() => parseArgs(["site"]), /unknown command/);
  assert.throws(() => parseArgs(["init", "--billing"]), /unknown flag/);
});

test("help text names init and deploy.sh, not site/", () => {
  const text = helpText();
  assert.match(text, /npx context101 init/);
  assert.match(text, /deploy\.sh/);
  assert.equal(text.includes("site/"), false);
});
