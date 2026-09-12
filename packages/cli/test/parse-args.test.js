import assert from "node:assert/strict";
import { test } from "node:test";
import { main } from "../src/main.js";
import { helpText, parseArgs } from "../src/parse-args.js";
import { memoryIo, testEnv } from "./helpers.js";

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
    "--skip-bedrock-access",
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
  assert.equal(opts.skipBedrockAccess, true);
  assert.equal(opts.envFile, "/tmp/deploy-env");
  assert.equal(opts.awsProfile, "findit");
  assert.equal(opts.awsAccessKeyId, "TESTACCESSKEYID12345");
  assert.equal(opts.awsSecretAccessKey, "test-secret-access-key-must-never-appear");
});

test("help init names the flags that --yes needs", () => {
  const text = helpText("init");
  assert.match(text, /required --aws-profile|required with --yes/);
  assert.match(text, /skip Amplify|skipped unless gh login/);
  assert.match(text, /embed-model/);
  assert.match(text, /skip-bedrock-access/);
  assert.match(text, /create-rds/);
});

test("rejects unknown command and flag", () => {
  assert.throws(() => parseArgs(["site"]), /unknown command/);
  assert.throws(() => parseArgs(["init", "--billing"]), /unknown flag/);
});

test("parses deploy command", () => {
  const opts = parseArgs(["deploy", "--seed", "--home"]);
  assert.equal(opts.command, "deploy");
  assert.equal(opts.seed, true);
  assert.equal(opts.home, true);
});

test("rejects init flags on deploy", () => {
  assert.throws(() => parseArgs(["deploy", "--yes"]), /init option/);
});

test("parses list and destroy aliases", () => {
  assert.equal(parseArgs(["list"]).command, "list");
  assert.equal(parseArgs(["ls"]).command, "list");
  assert.equal(parseArgs(["destroy", "Context101Stack", "--yes"]).command, "destroy");
  assert.equal(parseArgs(["destroy", "Context101Stack", "--yes"]).stackName, "Context101Stack");
  assert.equal(parseArgs(["destroy", "--yes"]).yes, true);
  assert.equal(parseArgs(["remove", "--dry-run"]).command, "destroy");
  assert.equal(parseArgs(["rm", "--aws-profile", "findit"]).awsProfile, "findit");
});

test("parses config and diff/synth", () => {
  assert.equal(parseArgs(["diff"]).command, "diff");
  assert.equal(parseArgs(["synth"]).command, "synth");
  assert.equal(parseArgs(["config"]).command, "config");
  const set = parseArgs(["config", "set", "CTX_TOKEN=ctx_secret"]);
  assert.equal(set.command, "config");
  assert.equal(set.configAction, "set");
  assert.equal(set.configKey, "CTX_TOKEN");
  assert.equal(set.configValue, "ctx_secret");
});

test("rejects init-only flags on list and seed on destroy", () => {
  assert.throws(() => parseArgs(["list", "--yes"]), /init option/);
  assert.throws(() => parseArgs(["destroy", "--embed-model", "x"]), /init option/);
  assert.throws(() => parseArgs(["destroy", "--seed"]), /deploy option/);
});

test("help text lists commands, not site/", () => {
  const text = helpText();
  assert.match(text, /context101-cli/);
  assert.match(text, /Context7/);
  assert.equal(text.includes("deploy.sh"), false);
  assert.equal(text.includes("site/"), false);
});

test("parses help and help <command>", () => {
  assert.equal(parseArgs(["help"]).command, "help");
  assert.equal(parseArgs(["--help"]).command, "help");
  assert.equal(parseArgs(["-h"]).command, "help");
  assert.equal(parseArgs(["help", "list"]).helpTopic, "list");
  assert.equal(parseArgs(["help", "ls"]).helpTopic, "list");
  assert.equal(parseArgs(["help", "config", "set"]).helpTopic, "config set");
  assert.equal(parseArgs(["destroy", "--help"]).command, "destroy");
  assert.equal(parseArgs(["destroy", "--help"]).help, true);
});

test("context101 help lists every command and exits 0", async () => {
  const io = memoryIo();
  const code = await main(["help"], {
    cwd: "/tmp",
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
  });
  assert.equal(code, 0);
  for (const name of [
    "init",
    "deploy",
    "diff",
    "synth",
    "list",
    "destroy",
    "config",
    "config set",
    "help",
  ]) {
    assert.match(io.stdoutText, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal(io.stdoutText.includes("deploy.sh"), false);
  assert.equal(io.stdoutText.includes("site/"), false);
});

test("context101 --help and -h match the short command list", async () => {
  const flags = ["--help", "-h"];
  for (const flag of flags) {
    const io = memoryIo();
    const code = await main([flag], {
      cwd: "/tmp",
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
    });
    assert.equal(code, 0);
    assert.match(io.stdoutText, /Usage: context101 <command>/);
    assert.match(io.stdoutText, /config set/);
  }
});

test("context101 help list shows list flags", async () => {
  const io = memoryIo();
  const code = await main(["help", "list"], {
    cwd: "/tmp",
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
  });
  assert.equal(code, 0);
  assert.match(io.stdoutText, /--aws-profile/);
  assert.match(io.stdoutText, /no checkout/);
});

test("workspace package is context101-cli with bin context101", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  assert.equal(pkg.name, "context101-cli");
  assert.equal(pkg.version, "0.1.2");
  assert.equal(pkg.private, false);
  assert.equal(pkg.bin.context101, "./bin/context101.js");
  assert.deepEqual(pkg.files, ["bin", "src"]);
});
