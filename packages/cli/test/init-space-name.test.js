import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "./run-main.js";
import {
  initSpaceNameRequiredMessage,
  spaceNameHelpLines,
  spaceNamePromptMessage,
  spaceNamePromptOptions,
  usingDefaultSpaceLine,
} from "../src/prompt.js";
import { DEFAULT_SPACE, defaultSpaceEnvPath } from "../src/spaces.js";
import {
  fakeExec,
  makeRepoFixture,
  memoryIo,
  tempHome,
  testEnv,
} from "./helpers.js";

function ttyIo() {
  const io = memoryIo();
  io.stdout.isTTY = true;
  io.stdin.isTTY = true;
  return io;
}

function interactiveAnswers(defaults) {
  return {
    region: defaults.region,
    repository: defaults.repository || "",
    databaseUrl: "postgresql://localhost/db",
    databaseDriver: "postgres-js",
    databasePrepare: true,
    awsProfile: defaults.awsProfile,
    awsAccessKeyId: defaults.awsAccessKeyId,
    awsSecretAccessKey: defaults.awsSecretAccessKey,
  };
}

const AWS_KEYS = {
  accessKeyId: "TESTACCESSKEYID12345",
  secretAccessKey: "test-secret-access-key-must-never-appear",
};

test("space name prompt copy explains the stack name, path, later commands, and rules", () => {
  const help = spaceNameHelpLines().join("\n");
  assert.match(help, /name of this stack\/space/);
  assert.match(help, /~\/\.context101\/spaces\/<name>\//);
  assert.match(help, /context101 update <name>/);
  assert.match(help, /urls <name>/);
  assert.match(help, /destroy <name>/);
  assert.match(help, /lowercase letters, numbers, hyphens/);
  assert.equal(spaceNamePromptMessage(), "space name");
  assert.equal(spaceNamePromptOptions().default, "");
  assert.equal(usingDefaultSpaceLine(), "using space default — ~/.context101/spaces/default/");
  assert.match(initSpaceNameRequiredMessage(), /space name/);
  assert.match(initSpaceNameRequiredMessage(), /TTY/);
});

test("TTY nameless init calls promptSpace with the explanatory message", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-space-tty-"));
  const home = await tempHome();
  await makeRepoFixture(root);
  const io = ttyIo();
  let prompted = null;

  const code = await main(
    ["init", "--database-url", "postgresql://localhost/db", "--force"],
    {
      cwd: root,
      homeDir: home,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec(),
      promptSpace: async (opts) => {
        prompted = opts;
        return "acme";
      },
      promptAwsKeys: async () => AWS_KEYS,
      promptAnswers: async ({ defaults }) => interactiveAnswers(defaults),
      confirmDeploy: async () => false,
    }
  );

  assert.equal(code, 0);
  assert.deepEqual(prompted, spaceNamePromptOptions());
  assert.match(prompted.help, /~\/\.context101\/spaces\/<name>\//);
  assert.match(prompted.help, /context101 update <name>/);
  assert.equal(prompted.default, "");
  const stdout = io.stdoutText;
  for (const line of spaceNameHelpLines()) {
    assert.equal(stdout.includes(line), true, `missing help line: ${line}`);
  }
  assert.equal(existsSync(defaultSpaceEnvPath("acme", home)), true);
  assert.equal(existsSync(defaultSpaceEnvPath(DEFAULT_SPACE, home)), false);
  assert.equal(stdout.includes(usingDefaultSpaceLine()), false);
});

test("--yes nameless init uses default and does not prompt", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-space-yes-"));
  const home = await tempHome();
  await makeRepoFixture(root);
  const io = ttyIo();
  let prompted = false;

  const code = await main(
    ["init", "--yes", "--force", "--database-url", "postgresql://localhost/db"],
    {
      cwd: root,
      homeDir: home,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec(),
      promptSpace: async () => {
        prompted = true;
        return "should-not-run";
      },
      promptAnswers: async () => {
        throw new Error("should not prompt answers");
      },
    }
  );

  assert.equal(code, 0);
  assert.equal(prompted, false);
  assert.equal(existsSync(defaultSpaceEnvPath(DEFAULT_SPACE, home)), true);
  assert.match(io.stdoutText, /using space default/);
  assert.match(io.stdoutText, /~\/\.context101\/spaces\/default\//);
  assert.equal(io.stdoutText.includes(spaceNameHelpLines()[0]), false);
});

test("passed space name wins over the prompt and --yes default", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-space-named-"));
  const home = await tempHome();
  await makeRepoFixture(root);
  const io = ttyIo();
  let prompted = false;

  const code = await main(
    ["init", "prod", "--yes", "--force", "--database-url", "postgresql://localhost/db"],
    {
      cwd: root,
      homeDir: home,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec(),
      promptSpace: async () => {
        prompted = true;
        return "default";
      },
    }
  );

  assert.equal(code, 0);
  assert.equal(prompted, false);
  assert.equal(existsSync(defaultSpaceEnvPath("prod", home)), true);
  assert.equal(existsSync(defaultSpaceEnvPath(DEFAULT_SPACE, home)), false);
  assert.equal(io.stdoutText.includes(usingDefaultSpaceLine()), false);
  assert.equal(io.stdoutText.includes(spaceNameHelpLines()[0]), false);
});

test("non-TTY nameless init without --yes fails instead of writing default", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-space-nontty-"));
  const home = await tempHome();
  await makeRepoFixture(root);
  const io = memoryIo();
  let prompted = false;

  const code = await main(["init", "--force"], {
    cwd: root,
    homeDir: home,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(),
    promptSpace: async () => {
      prompted = true;
      return "default";
    },
    promptAnswers: async () => {
      throw new Error("should not prompt answers");
    },
  });

  assert.equal(code, 1);
  assert.equal(prompted, false);
  assert.match(io.stderrText, /space name/);
  assert.match(io.stderrText, /TTY/);
  assert.equal(io.stderrText.includes(initSpaceNameRequiredMessage()), true);
  assert.equal(existsSync(defaultSpaceEnvPath(DEFAULT_SPACE, home)), false);
  assert.equal(io.stdoutText.includes(usingDefaultSpaceLine()), false);
});

test("dry-run without a name uses default and does not prompt", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-space-dry-"));
  const home = await tempHome();
  await makeRepoFixture(root);
  const io = memoryIo();
  let prompted = false;

  const code = await main(["init", "--dry-run"], {
    cwd: root,
    homeDir: home,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(),
    promptSpace: async () => {
      prompted = true;
      return "should-not-run";
    },
  });

  assert.equal(code, 0);
  assert.equal(prompted, false);
  assert.match(io.stdoutText, /using space default/);
  assert.match(io.stdoutText, /~\/\.context101\/spaces\/default\//);
  assert.equal(existsSync(defaultSpaceEnvPath(DEFAULT_SPACE, home)), false);
});

test("TTY empty space name is required and does not fall through to default", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-space-empty-"));
  const home = await tempHome();
  await makeRepoFixture(root);
  const io = ttyIo();

  const code = await main(
    ["init", "--database-url", "postgresql://localhost/db", "--force"],
    {
      cwd: root,
      homeDir: home,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec(),
      promptSpace: async () => "",
      promptAnswers: async () => {
        throw new Error("should not prompt answers");
      },
    }
  );

  assert.equal(code, 1);
  assert.match(io.stderrText, /space name required/);
  assert.equal(existsSync(defaultSpaceEnvPath(DEFAULT_SPACE, home)), false);
});
