import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ExitPromptError } from "@inquirer/core";
import { isExitPromptError, printCancelled, SIGINT_EXIT } from "../src/cancel.js";
import { STACK_NAME } from "../src/defaults.js";
import { main } from "../src/main.js";
import { palette, writers } from "../src/style.js";
import {
  exitPromptError,
  fakeExec,
  makeRepoFixture,
  memoryIo,
  mockCloneCheckout,
  testEnv,
} from "./helpers.js";

function withEnv(extra, fn) {
  const keys = Object.keys(extra);
  const prev = {};
  for (const key of keys) {
    prev[key] = process.env[key];
    const value = extra[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const key of keys) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

function listStacksPayload(summaries) {
  return {
    ok: true,
    code: 0,
    stdout: JSON.stringify({ StackSummaries: summaries }),
    stderr: "",
    error: null,
  };
}

const LIVE = {
  StackName: STACK_NAME,
  StackStatus: "CREATE_COMPLETE",
  LastUpdatedTime: "2026-09-12T20:00:00+00:00",
  TemplateDescription: "Context101 self-host",
};

function ttyIo() {
  const io = memoryIo();
  io.stdout.isTTY = true;
  io.stdin.isTTY = true;
  return io;
}

function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, "");
}

function assertQuietCancel(io, code) {
  assert.equal(code, SIGINT_EXIT);
  // CI has no NO_COLOR; mocked TTYs still color dim("cancelled").
  assert.match(stripAnsi(io.stdoutText), /^cancelled$/m);
  const err = stripAnsi(io.stderrText);
  assert.equal(err.includes("ExitPromptError"), false);
  assert.equal(err.includes("SIGINT"), false);
  assert.equal(err.includes("create-prompt"), false);
  assert.equal(err.includes("at Interface"), false);
  assert.equal(err.includes("✗"), false);
  assert.equal(err.includes("cancelled"), false);
}

function interactiveAnswers(defaults) {
  return {
    region: defaults.region,
    repository: defaults.repository || "",
    databaseUrl: "postgresql://localhost/db",
    databaseDriver: "postgres-js",
    databasePrepare: true,
    createRds: false,
    awsProfile: defaults.awsProfile,
    awsAccessKeyId: defaults.awsAccessKeyId,
    awsSecretAccessKey: defaults.awsSecretAccessKey,
  };
}

const MULTI_PROFILES = {
  "aws configure list-profiles": {
    ok: true,
    code: 0,
    stdout: "findit\nplateapr\n",
    stderr: "",
    error: null,
  },
};

test("isExitPromptError matches Inquirer Ctrl+C and ignores other errors", () => {
  assert.equal(isExitPromptError(exitPromptError()), true);
  assert.equal(
    isExitPromptError(new ExitPromptError("User force closed the prompt with SIGINT")),
    true
  );
  assert.equal(isExitPromptError(new Error("boom")), false);
  assert.equal(isExitPromptError({ name: "CancelPromptError" }), false);
  assert.equal(isExitPromptError(null), false);
});

test("quiet cancel matches a dim cancelled line when CI colors a mocked TTY", () => {
  const io = ttyIo();
  withEnv(
    { NO_COLOR: undefined, FORCE_COLOR: undefined, COLORTERM: undefined, TERM: "xterm-256color" },
    () => {
      assert.equal(printCancelled(writers(io)), SIGINT_EXIT);
    }
  );
  assert.match(io.stdoutText, /\x1b\[38;5;139mcancelled\x1b\[0m/);
  assertQuietCancel(io, SIGINT_EXIT);
});

test("printCancelled is one dusty-lilac dim line, not red", () => {
  const io = memoryIo();
  io.stdout.isTTY = true;
  withEnv(
    { NO_COLOR: undefined, FORCE_COLOR: undefined, COLORTERM: "truecolor" },
    () => {
      const w = writers(io);
      assert.equal(printCancelled(w), SIGINT_EXIT);
      assert.equal(w.c.dim, palette(io.stdout).dim);
      assert.match(io.stdoutText, /\x1b\[38;2;168;158;180mcancelled\x1b\[0m\n/);
      assert.equal(io.stdoutText.includes("\x1b[31m"), false);
      assert.equal(io.stdoutText.includes("✗"), false);
      assert.equal(io.stderrText, "");
    }
  );
});

test("Ctrl+C on the AWS profile picker exits 130 and writes nothing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-cancel-prof-"));
  await makeRepoFixture(root);
  const io = ttyIo();
  let deployed = false;
  let askedAnswers = false;

  const code = await main(["init", "--force"], {
    cwd: root,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(MULTI_PROFILES),
    chooseProfile: async () => {
      throw exitPromptError();
    },
    promptAnswers: async () => {
      askedAnswers = true;
      return {};
    },
    runDeploy: async () => {
      deployed = true;
      return 0;
    },
  });

  assertQuietCancel(io, code);
  assert.equal(askedAnswers, false);
  assert.equal(deployed, false);
  assert.equal(existsSync(path.join(root, "cdk", ".deploy-env")), false);
});

test("Ctrl+C on AWS keys exits 130 and writes nothing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-cancel-keys-"));
  await makeRepoFixture(root);
  const io = ttyIo();
  let deployed = false;

  const code = await main(["init", "--force"], {
    cwd: root,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(),
    promptAwsKeys: async () => {
      throw exitPromptError();
    },
    promptAnswers: async () => {
      throw new Error("promptAnswers should not run");
    },
    runDeploy: async () => {
      deployed = true;
      return 0;
    },
  });

  assertQuietCancel(io, code);
  assert.equal(deployed, false);
  assert.equal(existsSync(path.join(root, "cdk", ".deploy-env")), false);
});

test("Ctrl+C during promptAnswers exits 130 and writes nothing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-cancel-ans-"));
  await makeRepoFixture(root);
  const io = ttyIo();
  let deployed = false;

  const code = await main(
    ["init", "--database-url", "postgresql://localhost/db", "--force"],
    {
      cwd: root,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec(),
      promptAwsKeys: async () => ({
        accessKeyId: "TESTACCESSKEYID12345",
        secretAccessKey: "test-secret-access-key-must-never-appear",
      }),
      promptAnswers: async () => {
        throw exitPromptError();
      },
      confirmDeploy: async () => {
        throw new Error("confirmDeploy should not run");
      },
      runDeploy: async () => {
        deployed = true;
        return 0;
      },
    }
  );

  assertQuietCancel(io, code);
  assert.equal(deployed, false);
  assert.equal(existsSync(path.join(root, "cdk", ".deploy-env")), false);
});

test("Ctrl+C on deploy-now does not deploy", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-cancel-now-"));
  await makeRepoFixture(root);
  const io = ttyIo();
  let deployed = false;

  const code = await main(
    ["init", "--database-url", "postgresql://localhost/db", "--force"],
    {
      cwd: root,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec(),
      promptAwsKeys: async () => ({
        accessKeyId: "TESTACCESSKEYID12345",
        secretAccessKey: "test-secret-access-key-must-never-appear",
      }),
      promptAnswers: async ({ defaults }) => interactiveAnswers(defaults),
      confirmDeploy: async () => {
        throw exitPromptError();
      },
      runDeploy: async () => {
        deployed = true;
        return 0;
      },
    }
  );

  assertQuietCancel(io, code);
  assert.equal(deployed, false);
  assert.equal(existsSync(path.join(root, "cdk", ".deploy-env")), true);
  assert.match(io.stdoutText, /wrote cdk\/\.deploy-env/);
  assert.equal(io.stdoutText.includes("Deploying the stack"), false);
});

test("Ctrl+C on update prompt exits 130 and does not install", async () => {
  const io = ttyIo();
  let installed = false;

  const code = await main(["help"], {
    cwd: "/tmp",
    env: testEnv({ CONTEXT101_SKIP_UPDATE: "" }),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    packageVersion: "0.1.5",
    fetchNpmLatest: async () => "0.1.6",
    confirmUpdate: async () => {
      throw exitPromptError();
    },
    installCli: async () => {
      installed = true;
      return true;
    },
  });

  assertQuietCancel(io, code);
  assert.equal(installed, false);
  assert.equal(io.stdoutText.includes("Usage: context101"), false);
  assert.equal(io.stdoutText.includes("re-run context101"), false);
});

test("Ctrl+C during wizard after declining existing env exits 130 and does not overwrite", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-cancel-decline-"));
  await makeRepoFixture(root);
  const envPath = path.join(root, "cdk", ".deploy-env");
  const kept = 'CTX_TOKEN="ctx_keep_existing_token_xx"\nAWS_PROFILE="findit"\n';
  await writeFile(envPath, kept, "utf8");
  const io = ttyIo();
  let askedDeploy = false;
  let deployed = false;

  const code = await main(["init"], {
    cwd: root,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(MULTI_PROFILES),
    chooseProfile: async () => {
      throw exitPromptError();
    },
    promptAnswers: async () => {
      throw new Error("promptAnswers should not run");
    },
    confirmResume: async () => false,
    confirmDeploy: async () => {
      askedDeploy = true;
      return true;
    },
    runDeploy: async () => {
      deployed = true;
      return 0;
    },
  });

  assertQuietCancel(io, code);
  assert.equal(askedDeploy, false);
  assert.equal(deployed, false);
  const body = await readFile(envPath, "utf8");
  assert.equal(body, kept);
});

test("Ctrl+C on existing-env continue exits 130 and does not overwrite", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-cancel-keep-"));
  await makeRepoFixture(root);
  const envPath = path.join(root, "cdk", ".deploy-env");
  const kept = 'CTX_TOKEN="ctx_keep_existing_token_xx"\nAWS_PROFILE="findit"\n';
  await writeFile(envPath, kept, "utf8");
  const io = ttyIo();
  let askedAnswers = false;
  let askedDeploy = false;
  let deployed = false;

  const code = await main(["init"], {
    cwd: root,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(MULTI_PROFILES),
    chooseProfile: async () => {
      throw new Error("chooseProfile should not run");
    },
    promptAnswers: async () => {
      askedAnswers = true;
      return {};
    },
    confirmResume: async () => {
      throw exitPromptError();
    },
    confirmDeploy: async () => {
      askedDeploy = true;
      return true;
    },
    runDeploy: async () => {
      deployed = true;
      return 0;
    },
  });

  assertQuietCancel(io, code);
  assert.equal(askedAnswers, false);
  assert.equal(askedDeploy, false);
  assert.equal(deployed, false);
  const body = await readFile(envPath, "utf8");
  assert.equal(body, kept);
});

test("Ctrl+C on destroy confirm does not clone or destroy", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-cancel-rm-"));
  const io = ttyIo();
  let cloned = 0;
  let destroyed = false;

  const code = await main(["destroy", STACK_NAME], {
    cwd,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: (spec) => {
      if (spec.command === "git" && spec.args?.[0] === "clone") {
        cloned += 1;
        mockCloneCheckout(spec.args[spec.args.length - 1]);
        return { ok: true, code: 0, stdout: "", stderr: "", error: null };
      }
      return fakeExec({ listStacks: listStacksPayload([LIVE]) })(spec);
    },
    confirmDestroy: async () => {
      throw exitPromptError();
    },
    runDeploy: async () => {
      destroyed = true;
      return 0;
    },
  });

  assertQuietCancel(io, code);
  assert.equal(cloned, 0);
  assert.equal(destroyed, false);
});

test("Ctrl+C after clone-on-init does not clone again or write deploy-env", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-cancel-clone-"));
  const dest = path.join(cwd, "context101");
  const io = ttyIo();
  let clones = 0;
  let deployed = false;

  const code = await main(["init", "--force"], {
    cwd,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: (spec) => {
      if (spec.command === "git" && spec.args?.[0] === "clone") {
        clones += 1;
        mockCloneCheckout(spec.args[spec.args.length - 1]);
        return { ok: true, code: 0, stdout: "", stderr: "", error: null };
      }
      return fakeExec(MULTI_PROFILES)(spec);
    },
    chooseProfile: async () => {
      throw exitPromptError();
    },
    runDeploy: async () => {
      deployed = true;
      return 0;
    },
  });

  assertQuietCancel(io, code);
  assert.equal(clones, 1);
  assert.equal(deployed, false);
  assert.equal(existsSync(path.join(dest, "cdk", ".deploy-env")), false);
});

test("non-cancel prompt failures still throw", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-cancel-boom-"));
  await makeRepoFixture(root);
  const io = ttyIo();

  await assert.rejects(
    () =>
      main(["init", "--force"], {
        cwd: root,
        env: testEnv(),
        stdout: io.stdout,
        stderr: io.stderr,
        stdin: io.stdin,
        exec: fakeExec(MULTI_PROFILES),
        chooseProfile: async () => {
          throw new Error("sts exploded");
        },
      }),
    /sts exploded/
  );
  assert.equal(io.stdoutText.includes("cancelled"), false);
  assert.equal(existsSync(path.join(root, "cdk", ".deploy-env")), false);
});
