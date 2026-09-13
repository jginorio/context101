import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { SMOOTH_REGION } from "../src/defaults.js";
import { main } from "./run-main.js";
import { existingEnvContinueMessage } from "../src/prompt.js";
import { collectSecrets } from "../src/redact.js";
import {
  fakeExec,
  keepDefaultSpace,
  makeRepoFixture,
  memoryIo,
  tempHome,
  testEnv,
  writeTestDeployEnv,
} from "./helpers.js";

const KEEP_TOKEN = "ctx_keep_existing_token_xx";
const KEEP_AUTH = "keep-better-auth-secret-xx";
const KEEP_PEPPER = "keep-mcp-token-pepper-xx";
const KEEP_GH = "ghp_keep_existing_gh_token_xx";
const KEEP_DB = "postgresql://user:keep-existing-db-secret@localhost/app";
const KEEP_REPO = "https://github.com/acme/watched-repo";

function ttyIo() {
  const io = memoryIo();
  io.stdout.isTTY = true;
  io.stdin.isTTY = true;
  return io;
}

async function writeExistingEnv(root, extra = "") {
  await writeTestDeployEnv(
    root,
    [
      `CTX_TOKEN="${KEEP_TOKEN}"`,
      `CTX_GH_TOKEN="${KEEP_GH}"`,
      `BETTER_AUTH_SECRET="${KEEP_AUTH}"`,
      `MCP_TOKEN_PEPPER="${KEEP_PEPPER}"`,
      `AWS_PROFILE="findit"`,
      `AWS_REGION="${SMOOTH_REGION}"`,
      `DATABASE_URL="${KEEP_DB}"`,
      extra,
    ]
      .filter(Boolean)
      .join("\n")
  );
}

function existingEnvBody(root) {
  return readFile(path.join(root, "cdk", ".deploy-env"), "utf8");
}

function assertNoWizard(io, hooks) {
  assert.equal(hooks.askedAnswers, false);
  assert.equal(hooks.askedProfile, false);
  assert.equal(hooks.askedKeys, false);
  assert.equal(io.stdoutText.includes("AWS region"), false);
  assert.equal(io.stdoutText.includes("Amplify frontend"), false);
  assert.equal(io.stdoutText.includes("Postgres control plane"), false);
  assert.equal(io.stdoutText.includes("wrote cdk/.deploy-env"), false);
}

function assertSecretsHidden(io) {
  const text = `${io.stdoutText}\n${io.stderrText}`;
  const secrets = collectSecrets({
    CTX_TOKEN: KEEP_TOKEN,
    BETTER_AUTH_SECRET: KEEP_AUTH,
    MCP_TOKEN_PEPPER: KEEP_PEPPER,
    CTX_GH_TOKEN: KEEP_GH,
    DATABASE_URL: KEEP_DB,
  });
  for (const secret of secrets) {
    assert.equal(text.includes(secret), false, "stdout leaked a secret");
  }
}

function wizardHooks(answerFn) {
  const hooks = {
    askedAnswers: false,
    askedProfile: false,
    askedKeys: false,
    profileCurrent: null,
    defaults: null,
  };
  return {
    hooks,
    chooseProfile: async (profiles, { current } = {}) => {
      hooks.askedProfile = true;
      hooks.profileCurrent = current;
      return "plateapr";
    },
    promptAwsKeys: async () => {
      hooks.askedKeys = true;
      return {
        accessKeyId: "TESTACCESSKEYID12345",
        secretAccessKey: "test-secret-access-key-must-never-appear",
      };
    },
    promptAnswers: async ({ defaults }) => {
      hooks.askedAnswers = true;
      hooks.defaults = defaults;
      if (answerFn) return answerFn(defaults);
      return {};
    },
    promptSpace: keepDefaultSpace,
  };
}

function seededRewriteAnswers(defaults, extra = {}) {
  return {
    region: extra.region ?? defaults.region,
    repository: extra.repository ?? defaults.repository ?? "",
    databaseUrl: extra.databaseUrl ?? "",
    databaseDriver: "postgres-js",
    databasePrepare: true,
    createRds: extra.createRds ?? true,
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

test("existingEnvContinueMessage is short and has no em dash", () => {
  assert.equal(existingEnvContinueMessage(), "Continue with these values?");
  assert.equal(existingEnvContinueMessage().includes("—"), false);
  assert.equal(existingEnvContinueMessage().includes("–"), false);
});

test("existing env + TTY continue keeps secrets and skips the wizard", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-keep-"));
  await makeRepoFixture(root);
  await writeExistingEnv(root);
  const before = await existingEnvBody(root);
  const io = ttyIo();
  const { hooks, ...prompts } = wizardHooks();
  const stsProfiles = [];
  let askedResume = false;
  let askedDeploy = false;
  let deployed = false;

  const code = await main(["init"], {
    cwd: root,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: (opts) => {
      if (opts.command === "aws" && opts.args?.[0] === "sts") {
        stsProfiles.push(opts.env?.AWS_PROFILE ?? null);
      }
      return fakeExec(MULTI_PROFILES)(opts);
    },
    ...prompts,
    confirmResume: async () => {
      askedResume = true;
      return true;
    },
    confirmDeploy: async (details) => {
      askedDeploy = true;
      assert.equal(details.createRds, false);
      return false;
    },
    runDeploy: async () => {
      deployed = true;
      return 0;
    },
  });

  assert.equal(code, 0);
  assert.equal(askedResume, true);
  assert.equal(askedDeploy, true);
  assert.equal(deployed, false);
  assertNoWizard(io, hooks);
  assert.deepEqual(stsProfiles, ["findit"]);
  assert.equal(await existingEnvBody(root), before);
  assert.match(io.stdoutText, /cdk\/\.deploy-env already exists/);
  assert.match(io.stdoutText, /profile   findit/);
  assert.match(io.stdoutText, new RegExp(`region    ${SMOOTH_REGION}`));
  assert.match(io.stdoutText, /postgres  DATABASE_URL/);
  assert.match(io.stdoutText, /AWS profile findit/);
  assert.match(io.stdoutText, /^context101 deploy$/m);
  assertSecretsHidden(io);
});

test("existing env + TTY decline walks the wizard and keeps secrets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-decline-"));
  await makeRepoFixture(root);
  await writeExistingEnv(root, `REPOSITORY="${KEEP_REPO}"`);
  const io = ttyIo();
  const { hooks, ...prompts } = wizardHooks((defaults) =>
    seededRewriteAnswers(defaults, { createRds: true, repository: "" })
  );
  let askedDeploy = false;
  let deployed = false;
  const stsProfiles = [];

  const code = await main(["init"], {
    cwd: root,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: (opts) => {
      if (opts.command === "aws" && opts.args?.[0] === "sts") {
        stsProfiles.push(opts.env?.AWS_PROFILE ?? null);
      }
      return fakeExec(MULTI_PROFILES)(opts);
    },
    ...prompts,
    confirmResume: async () => false,
    confirmDeploy: async (details) => {
      askedDeploy = true;
      assert.equal(details.createRds, true);
      return false;
    },
    runDeploy: async () => {
      deployed = true;
      return 0;
    },
  });

  assert.equal(code, 0);
  assert.equal(askedDeploy, true);
  assert.equal(deployed, false);
  assert.equal(hooks.askedAnswers, true);
  assert.equal(hooks.askedProfile, true);
  assert.equal(hooks.askedKeys, false);
  assert.equal(hooks.profileCurrent, "findit");
  assert.equal(hooks.defaults.region, SMOOTH_REGION);
  assert.equal(hooks.defaults.repository, KEEP_REPO);
  assert.equal(hooks.defaults.databaseUrl, KEEP_DB);
  assert.equal(hooks.defaults.createRds, false);
  assert.deepEqual(stsProfiles, ["plateapr"]);
  const body = await existingEnvBody(root);
  assert.match(body, new RegExp(`CTX_TOKEN="${KEEP_TOKEN}"`));
  assert.match(body, new RegExp(`BETTER_AUTH_SECRET="${KEEP_AUTH}"`));
  assert.match(body, new RegExp(`MCP_TOKEN_PEPPER="${KEEP_PEPPER}"`));
  assert.match(body, new RegExp(`CTX_GH_TOKEN="${KEEP_GH}"`));
  assert.match(body, /AWS_PROFILE="plateapr"/);
  assert.match(body, /CREATE_RDS="true"/);
  assert.equal(body.includes(KEEP_DB), false);
  assert.equal(body.includes(KEEP_REPO), false);
  assert.match(io.stdoutText, /already exists/);
  assert.match(io.stdoutText, /profile   findit/);
  assert.match(io.stdoutText, /postgres  DATABASE_URL/);
  assert.match(io.stdoutText, /wrote cdk\/\.deploy-env/);
  assert.match(io.stdoutText, /^context101 deploy$/m);
  assert.equal(io.stdoutText.includes("Left as-is"), false);
  assert.equal(io.stdoutText.includes("Re-run with --force"), false);
  assert.equal(io.stdoutText.includes("start over"), false);
  assert.equal(io.stdoutText.includes("Deploying the stack"), false);
  assertSecretsHidden(io);
});

test("existing env + TTY decline seeds RDS vs Amplify skip", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-decline-rds-"));
  await makeRepoFixture(root);
  await writeExistingEnv(root, `CREATE_RDS="true"`);
  const io = ttyIo();
  const { hooks, ...prompts } = wizardHooks((defaults) =>
    seededRewriteAnswers(defaults, { createRds: true, repository: "" })
  );

  const code = await main(["init"], {
    cwd: root,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(MULTI_PROFILES),
    ...prompts,
    confirmResume: async () => false,
    confirmDeploy: async () => false,
  });

  assert.equal(code, 0);
  assert.equal(hooks.askedAnswers, true);
  assert.equal(hooks.defaults.repository, "");
  assert.equal(hooks.defaults.createRds, true);
  assert.match(io.stdoutText, /postgres  RDS/);
  assert.match(io.stdoutText, /wrote cdk\/\.deploy-env/);
  const body = await existingEnvBody(root);
  assert.match(body, new RegExp(`CTX_TOKEN="${KEEP_TOKEN}"`));
  assertSecretsHidden(io);
});

test("existing env + non-TTY fails immediately", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-nontty-"));
  await makeRepoFixture(root);
  await writeExistingEnv(root);
  const before = await existingEnvBody(root);
  const io = memoryIo();
  const { hooks, ...prompts } = wizardHooks();
  let askedResume = false;
  let askedDeploy = false;

  const code = await main(["init"], {
    cwd: root,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(MULTI_PROFILES),
    ...prompts,
    confirmResume: async () => {
      askedResume = true;
      return true;
    },
    confirmDeploy: async () => {
      askedDeploy = true;
      return true;
    },
  });

  assert.equal(code, 1);
  assert.equal(askedResume, false);
  assert.equal(askedDeploy, false);
  assertNoWizard(io, hooks);
  assert.equal(await existingEnvBody(root), before);
  assert.match(io.stderrText, /already exists/);
  assert.match(io.stderrText, /--force/);
  assert.equal(io.stdoutText.includes("profile   findit"), false);
  assertSecretsHidden(io);
});

test("--force still overwrites an existing env", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-force-ow-"));
  await makeRepoFixture(root);
  const envPath = path.join(root, "cdk", ".deploy-env");
  await writeFile(envPath, `CTX_TOKEN="${KEEP_TOKEN}"\n`, "utf8");
  const io = memoryIo();
  let askedResume = false;

  const code = await main(
    ["init", "--yes", "--database-url", "postgresql://localhost/db", "--force"],
    {
      cwd: root,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec(),
      confirmResume: async () => {
        askedResume = true;
        return false;
      },
    }
  );

  assert.equal(code, 0);
  assert.equal(askedResume, false);
  assert.equal(existsSync(envPath), true);
  const body = await readFile(envPath, "utf8");
  assert.equal(body.includes(KEEP_TOKEN), false);
  assert.match(body, /^CTX_TOKEN="/m);
  assert.match(io.stdoutText, /wrote cdk\/\.deploy-env/);
});

test("TTY --force skips resume and generates new secrets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-force-tty-"));
  await makeRepoFixture(root);
  await writeExistingEnv(root);
  const io = ttyIo();
  const { hooks, ...prompts } = wizardHooks((defaults) =>
    seededRewriteAnswers(defaults, {
      createRds: false,
      databaseUrl: "postgresql://localhost/rewritten",
    })
  );
  let askedResume = false;

  const code = await main(["init", "--force"], {
    cwd: root,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(MULTI_PROFILES),
    ...prompts,
    confirmResume: async () => {
      askedResume = true;
      return true;
    },
    confirmDeploy: async () => false,
  });

  assert.equal(code, 0);
  assert.equal(askedResume, false);
  assert.equal(hooks.askedAnswers, true);
  assert.equal(hooks.askedProfile, true);
  assert.equal(io.stdoutText.includes("already exists"), false);
  assert.equal(io.stdoutText.includes("Continue with these values"), false);
  const body = await existingEnvBody(root);
  assert.equal(body.includes(KEEP_TOKEN), false);
  assert.equal(body.includes(KEEP_AUTH), false);
  assert.equal(body.includes(KEEP_PEPPER), false);
  assert.equal(body.includes(KEEP_GH), false);
  assert.match(body, /^CTX_TOKEN="/m);
  assert.match(io.stdoutText, /wrote cdk\/\.deploy-env/);
  assertSecretsHidden(io);
});

test("existing env + TTY continue then deploy uses loaded AWS auth", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-keep-dep-"));
  await makeRepoFixture(root);
  await writeExistingEnv(root, `CREATE_RDS="true"`);
  const before = await existingEnvBody(root);
  const io = ttyIo();
  const { hooks, ...prompts } = wizardHooks();
  const calls = [];

  const code = await main(["init"], {
    cwd: root,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(),
    ...prompts,
    confirmResume: async () => true,
    confirmDeploy: async (details) => {
      assert.equal(details.createRds, true);
      return true;
    },
    runDeploy: async (spec) => {
      calls.push(spec);
      return 0;
    },
  });

  assert.equal(code, 0);
  assertNoWizard(io, hooks);
  assert.equal(await existingEnvBody(root), before);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].repoRoot, root);
  assert.equal(calls[0].env.AWS_PROFILE, "findit");
  assert.match(io.stdoutText, /postgres  RDS/);
  assert.match(io.stdoutText, /[Dd]eploying/);
  assertSecretsHidden(io);
});
