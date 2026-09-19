import assert from "node:assert/strict";
import { test } from "node:test";
import { main } from "./run-main.js";
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
  assert.match(text, /CodeCommit|optional GitHub override/);
  assert.match(text, /embed-model/);
  assert.match(text, /skip-bedrock-access/);
  assert.match(text, /create-rds/);
  assert.match(text, /Existing deploy-env/);
  assert.match(text, /No continues the wizard \(same secrets\)/);
  assert.match(text, /--force starts over \(new secrets\)/);
  assert.match(text, /context101 update <space>/);
  assert.match(text, /No name: TTY asks/);
  assert.match(text, /non-TTY needs a name/);
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

test("parses update as a deploy alias, like url → urls", () => {
  const named = parseArgs(["update", "testingcontext101", "--dry-run"]);
  assert.equal(named.command, "deploy");
  assert.equal(named.space, "testingcontext101");
  assert.equal(named.dryRun, true);
  const flagged = parseArgs(["update", "--seed", "--home"]);
  assert.equal(flagged.command, "deploy");
  assert.equal(flagged.seed, true);
  assert.equal(flagged.home, true);
  assert.throws(() => parseArgs(["update", "--yes"]), /init option/);
  assert.equal(parseArgs(["help", "update"]).helpTopic, "deploy");
  assert.equal(parseArgs(["help", "deploy"]).helpTopic, "deploy");
});

test("allows --dir on deploy / diff / synth", () => {
  assert.equal(parseArgs(["deploy", "--dir", "my-stack"]).dir, "my-stack");
  assert.equal(parseArgs(["diff", "--dir", "my-stack"]).dir, "my-stack");
  assert.equal(parseArgs(["synth", "--dir", "my-stack"]).dir, "my-stack");
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

test("parses urls / url with list AWS flags and a space name", () => {
  const named = parseArgs(["urls", "testingcontext101", "--aws-profile", "findit"]);
  assert.equal(named.command, "urls");
  assert.equal(named.space, "testingcontext101");
  assert.equal(named.stackName, "testingcontext101");
  assert.equal(named.awsProfile, "findit");
  const alias = parseArgs([
    "url",
    "testingcontext101",
    "--aws-access-key-id",
    "TESTACCESSKEYID12345",
    "--aws-secret-access-key",
    "test-secret-access-key-must-never-appear",
  ]);
  assert.equal(alias.command, "urls");
  assert.equal(alias.space, "testingcontext101");
  assert.equal(alias.awsAccessKeyId, "TESTACCESSKEYID12345");
  assert.equal(alias.awsSecretAccessKey, "test-secret-access-key-must-never-appear");
  assert.throws(() => parseArgs(["urls", "a", "b"]), /one space name/);
  assert.throws(() => parseArgs(["urls", "--yes"]), /init option/);
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
  assert.throws(() => parseArgs(["urls", "--yes"]), /init option/);
  assert.throws(() => parseArgs(["destroy", "--embed-model", "x"]), /init option/);
  assert.throws(() => parseArgs(["destroy", "--seed"]), /deploy option/);
});

test("help text lists commands, not site/", () => {
  const text = helpText();
  assert.match(text, /context101-cli/);
  assert.match(text, /Context7/);
  assert.match(text, /^ {2}update\s+update a space from this CLI version$/m);
  assert.match(text, /^ {2}deploy\s+same as update$/m);
  assert.equal(text.includes("deploy.sh"), false);
  assert.equal(text.includes("site/"), false);
});

test("help update and help deploy share the update-face topic", () => {
  const update = helpText("update");
  const deploy = helpText("deploy");
  assert.equal(update, deploy);
  assert.match(update, /update \[space\]/);
  assert.match(update, /Also: deploy/);
  assert.match(helpText("init"), /context101 update <space>/);
  assert.equal(helpText("init").includes("context101 deploy <space>"), false);
});

test("parses help and help <command>", () => {
  assert.equal(parseArgs(["help"]).command, "help");
  assert.equal(parseArgs(["--help"]).command, "help");
  assert.equal(parseArgs(["-h"]).command, "help");
  assert.equal(parseArgs(["help", "list"]).helpTopic, "list");
  assert.equal(parseArgs(["help", "ls"]).helpTopic, "list");
  assert.equal(parseArgs(["help", "urls"]).helpTopic, "urls");
  assert.equal(parseArgs(["help", "url"]).helpTopic, "urls");
  assert.equal(parseArgs(["help", "update"]).helpTopic, "deploy");
  assert.equal(parseArgs(["help", "deploy"]).helpTopic, "deploy");
  assert.equal(parseArgs(["help", "config", "set"]).helpTopic, "config set");
  assert.equal(parseArgs(["help", "version"]).helpTopic, "version");
  assert.equal(parseArgs(["destroy", "--help"]).command, "destroy");
  assert.equal(parseArgs(["destroy", "--help"]).help, true);
});

test("parses version, -v, and --version", () => {
  assert.equal(parseArgs(["version"]).command, "version");
  assert.equal(parseArgs(["--version"]).command, "version");
  assert.equal(parseArgs(["-v"]).command, "version");
  assert.equal(parseArgs(["version", "--version"]).command, "version");
  assert.equal(parseArgs(["version", "-v"]).command, "version");
  assert.equal(parseArgs(["version", "--help"]).command, "version");
  assert.equal(parseArgs(["version", "--help"]).help, true);
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
    "update",
    "deploy",
    "diff",
    "synth",
    "list",
    "urls",
    "destroy",
    "config",
    "config set",
    "connectors",
    "connectors setup",
    "help",
    "version",
  ]) {
    assert.match(io.stdoutText, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(io.stdoutText, /your context\. every agent\./);
  assert.equal(io.stdoutText.includes("self-host setup"), false);
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

test("context101 version prints the package version and exits 0", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));

  for (const argv of [["version"], ["-v"], ["--version"]]) {
    const io = memoryIo();
    const code = await main(argv, {
      cwd: "/tmp",
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
    });
    assert.equal(code, 0);
    assert.equal(io.stdoutText, `context101-cli ${pkg.version}\n`);
    assert.equal(io.stdoutText.includes("your context. every agent."), false);
    assert.equal(io.stdoutText.includes("Context101\n"), false);
    assert.equal(io.stdoutText.includes("—"), false);
  }
});

test("context101 help version shows topic help", async () => {
  const io = memoryIo();
  const code = await main(["help", "version"], {
    cwd: "/tmp",
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
  });
  assert.equal(code, 0);
  assert.match(io.stdoutText, /your context\. every agent\./);
  assert.match(io.stdoutText, /print the installed CLI version/);
  assert.match(io.stdoutText, /--version/);
  const topic = helpText("version");
  assert.equal(topic.includes("—"), false);
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

test("context101 help update lists the update face and deploy alias", async () => {
  const io = memoryIo();
  const code = await main(["help", "update"], {
    cwd: "/tmp",
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
  });
  assert.equal(code, 0);
  assert.match(io.stdoutText, /update \[space\]/);
  assert.match(io.stdoutText, /Also: deploy/);
  assert.equal(io.stdoutText.includes("@latest"), false);
});

test("context101 help urls shows urls flags", async () => {
  const io = memoryIo();
  const code = await main(["help", "urls"], {
    cwd: "/tmp",
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
  });
  assert.equal(code, 0);
  assert.match(io.stdoutText, /urls \[space\]/);
  assert.match(io.stdoutText, /public admin and MCP URLs/);
  assert.match(io.stdoutText, /--aws-profile/);
  assert.match(io.stdoutText, /--aws-access-key-id/);
  assert.match(io.stdoutText, /--aws-secret-access-key/);
  assert.equal(io.stdoutText.includes("CTX_TOKEN"), false);
  assert.equal(io.stdoutText.includes("bearer"), false);
});

test("workspace package is context101-cli with bin context101", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  assert.equal(pkg.name, "context101-cli");
  assert.equal(pkg.version, "0.1.24");
  assert.equal(pkg.private, false);
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.bin.context101, "./bin/context101.js");
  assert.deepEqual(pkg.files, ["bin", "src", "stack"]);
  assert.equal(pkg.homepage, "https://github.com/jginorio/context101");
  assert.equal(pkg.repository?.url, "https://github.com/jginorio/context101.git");
  assert.match(pkg.description, /Context7/);
  assert.equal(pkg.description.includes("npx context101-cli"), true);
});

test("npm README is on-brand and warns about the Context7 name collision", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const readmePath = fileURLToPath(new URL("../README.md", import.meta.url));
  const text = await readFile(readmePath, "utf8");
  assert.match(text, /^# context101-cli/m);
  assert.match(text, /your context\. every agent\./);
  assert.match(text, /npx -y context101-cli@0\.1\.24/);
  assert.match(text, /npm i -g context101-cli@0\.1\.24/);
  assert.equal(text.includes("context101-cli@latest"), false);
  assert.match(text, /Context7/);
  assert.match(text, /https:\/\/github.com\/jginorio\/context101/);
  assert.match(text, /spaces\/<name>/);
  assert.match(text, /nameless `init` prompts/);
  assert.match(text, /\.cache\/context101/);
  assert.match(text, /update platea/);
  assert.match(text, /connectors setup/);
  assert.match(text, /--verbose/);
  assert.match(text, /not a git pull/);
  assert.equal(text.includes("npx context101"), true);
  assert.equal(text.includes("billing"), false);
  assert.equal(text.includes("SaaS"), false);
  assert.equal(text.includes("deploy.sh"), false);
  assert.equal(text.includes("site/"), false);
});
