import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readExampleToken } from "../src/env-file.js";
import { main } from "../src/main.js";
import { collectSecrets } from "../src/redact.js";
import { findRepoRoot } from "../src/repo.js";
import { fakeExec, makeRepoFixture, memoryIo, testEnv } from "./helpers.js";

test("--yes writes chmod 600 env and never prints secrets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-yes-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const secretUrl = "postgresql://user:yes-secret-db@localhost/app";
  const envPath = path.join(root, "tmp-deploy-env");
  let deployed = false;

  const code = await main(
    [
      "init",
      "--yes",
      "--database-url",
      secretUrl,
      "--deploy-env",
      envPath,
      "--aws-profile",
      "dev",
    ],
    {
      cwd: root,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec(),
      runDeploy: async () => {
        deployed = true;
        return 0;
      },
    }
  );

  assert.equal(code, 0);
  assert.equal(existsSync(envPath), true);
  const st = await stat(envPath);
  assert.equal(st.mode & 0o777, 0o600);

  const body = await readFile(envPath, "utf8");
  assert.match(body, /^CTX_TOKEN="/m);
  assert.match(body, /^BETTER_AUTH_SECRET="/m);
  assert.match(body, /^MCP_TOKEN_PEPPER="/m);
  assert.match(body, /^DATABASE_URL="/m);
  assert.equal(body.includes("CREATE_RDS="), false);
  assert.match(body, /DATABASE_DRIVER="postgres-js"/);
  assert.match(body, /APP_MODE="self_hosted"/);
  assert.match(body, /ALLOW_PUBLIC_SIGNUP="false"/);
  assert.match(body, /BILLING_ENABLED="false"/);
  assert.match(body, /AWS_PROFILE="dev"/);
  assert.equal(body.includes("REPOSITORY="), false);
  assert.equal(body.includes("EMBED_MODEL_ID="), false);
  assert.equal(body.includes("example-do-not-copy"), false);
  assert.equal(body.includes("site/"), false);

  const token = body.match(/^CTX_TOKEN="([^"]+)"/m)[1];
  const fixtureExample = await readExampleToken(
    path.join(root, "cdk", ".deploy-env.example")
  );
  assert.notEqual(token, fixtureExample);
  const checkout = findRepoRoot(import.meta.dirname);
  if (checkout) {
    const repoExample = await readExampleToken(
      path.join(checkout, "cdk", ".deploy-env.example")
    );
    if (repoExample) assert.notEqual(token, repoExample);
  }
  const auth = body.match(/^BETTER_AUTH_SECRET="([^"]+)"/m)[1];
  const pepper = body.match(/^MCP_TOKEN_PEPPER="([^"]+)"/m)[1];
  const secrets = collectSecrets({
    CTX_TOKEN: token,
    BETTER_AUTH_SECRET: auth,
    MCP_TOKEN_PEPPER: pepper,
    DATABASE_URL: secretUrl,
  });

  const text = `${io.stdoutText}\n${io.stderrText}`;
  for (const secret of secrets) {
    assert.equal(text.includes(secret), false, "stdout leaked a secret");
  }
  assert.equal(text.includes("ghp_test_token_must_never_appear"), false);
  assert.match(text, /wrote tmp-deploy-env/);
  assert.match(text, /^context101 deploy$/m);
  assert.equal(text.includes("deploy.sh"), false);
  assert.equal(text.includes("Amplify is skipped —"), false);
  assert.equal(text.includes("BETTER_AUTH_URL"), false);
  assert.equal(text.includes("site/"), false);
  assert.equal(deployed, false);
});

test("--yes refuses to overwrite without --force", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-ow-"));
  await makeRepoFixture(root);
  const envPath = path.join(root, "cdk", ".deploy-env");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(envPath, "CTX_TOKEN=keep-me\n", "utf8");
  const io = memoryIo();
  let askedAnswers = false;
  let askedProfile = false;

  const code = await main(
    ["init", "--yes", "--database-url", "postgresql://localhost/db"],
    {
      cwd: root,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec({
        "aws configure list-profiles": {
          ok: true,
          code: 0,
          stdout: "findit\nplateapr\n",
          stderr: "",
          error: null,
        },
      }),
      chooseProfile: async () => {
        askedProfile = true;
        return "findit";
      },
      promptAnswers: async () => {
        askedAnswers = true;
        return {};
      },
    }
  );

  assert.equal(code, 1);
  assert.equal(askedAnswers, false);
  assert.equal(askedProfile, false);
  assert.match(io.stderrText, /already exists/);
  assert.match(io.stderrText, /--force/);
  assert.equal(io.stdoutText.includes("AWS region"), false);
  assert.equal(io.stdoutText.includes("Amplify frontend"), false);
  const body = await readFile(envPath, "utf8");
  assert.equal(body, "CTX_TOKEN=keep-me\n");
});

test("--yes with one AWS profile writes it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-oneprof-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const envPath = path.join(root, "cdk", ".deploy-env");
  const env = testEnv();

  const code = await main(
    ["init", "--yes", "--database-url", "postgresql://localhost/db", "--force"],
    {
      cwd: root,
      env,
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec({
        "aws configure list-profiles": {
          ok: true,
          code: 0,
          stdout: "findit\n",
          stderr: "",
          error: null,
        },
      }),
    }
  );

  assert.equal(code, 0);
  const body = await readFile(envPath, "utf8");
  assert.match(body, /AWS_PROFILE="findit"/);
  assert.match(io.stdoutText, /AWS profile findit/);
});

test("--yes with several AWS profiles needs --aws-profile", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-profiles-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const env = testEnv();

  const code = await main(
    ["init", "--yes", "--database-url", "postgresql://localhost/db", "--force"],
    {
      cwd: root,
      env,
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec({
        "aws configure list-profiles": {
          ok: true,
          code: 0,
          stdout: "findit\nplateapr\n",
          stderr: "",
          error: null,
        },
      }),
    }
  );

  assert.equal(code, 1);
  assert.match(io.stderrText, /multiple AWS profiles/);
  assert.match(io.stderrText, /--aws-profile/);
  assert.equal(existsSync(path.join(root, "cdk", ".deploy-env")), false);
});

test("interactive init asks which AWS profile and writes it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-askprof-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  io.stdout.isTTY = true;
  io.stdin.isTTY = true;
  const env = testEnv();

  let asked = null;
  const stsProfiles = [];
  const exec = fakeExec({
    "aws configure list-profiles": {
      ok: true,
      code: 0,
      stdout: "findit\nplateapr\n",
      stderr: "",
      error: null,
    },
  });

  const code = await main(
    ["init", "--database-url", "postgresql://localhost/db", "--force"],
    {
      cwd: root,
      env,
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: (opts) => {
        if (opts.command === "aws" && opts.args?.[0] === "sts") {
          stsProfiles.push(opts.env?.AWS_PROFILE ?? null);
        }
        return exec(opts);
      },
      chooseProfile: async (profiles) => {
        asked = profiles;
        return "plateapr";
      },
      promptAnswers: async ({ defaults }) => ({
        region: defaults.region,
        repository: defaults.repository,
        databaseUrl: "postgresql://localhost/db",
        databaseDriver: "postgres-js",
        databasePrepare: true,
        awsProfile: defaults.awsProfile,
        awsAccessKeyId: defaults.awsAccessKeyId,
        awsSecretAccessKey: defaults.awsSecretAccessKey,
        seed: false,
        deploy: false,
        extras: "skip",
      }),
      confirmDeploy: async () => false,
    }
  );

  assert.equal(code, 0);
  assert.deepEqual(asked, ["findit", "plateapr"]);
  assert.deepEqual(stsProfiles, ["plateapr"]);
  const body = await readFile(path.join(root, "cdk", ".deploy-env"), "utf8");
  assert.match(body, /AWS_PROFILE="plateapr"/);
  assert.match(io.stdoutText, /AWS profile plateapr/);
});

test("--yes with no AWS profile writes access keys and never prints them", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-yes-keys-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const envPath = path.join(root, "cdk", ".deploy-env");
  const secret = "test-secret-access-key-must-never-appear";
  const keyId = "TESTACCESSKEYID12345";

  const code = await main(
    ["init", "--yes", "--database-url", "postgresql://localhost/db", "--force"],
    {
      cwd: root,
      env: testEnv({
        AWS_ACCESS_KEY_ID: keyId,
        AWS_SECRET_ACCESS_KEY: secret,
      }),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec(),
    }
  );

  assert.equal(code, 0);
  const body = await readFile(envPath, "utf8");
  assert.match(body, /AWS_ACCESS_KEY_ID="TESTACCESSKEYID12345"/);
  assert.match(body, /AWS_SECRET_ACCESS_KEY="test-secret-access-key-must-never-appear"/);
  assert.equal(body.includes("AWS_PROFILE="), false);
  const text = `${io.stdoutText}\n${io.stderrText}`;
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes(keyId), false);
  assert.match(text, /AWS access keys \(no profile\)/);
});

test("interactive init asks for AWS keys when no profiles exist", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-askkeys-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  io.stdout.isTTY = true;
  io.stdin.isTTY = true;
  const secret = "test-secret-access-key-must-never-appear";
  let prompted = false;
  const stsKeys = [];

  const code = await main(
    ["init", "--database-url", "postgresql://localhost/db", "--force"],
    {
      cwd: root,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: (opts) => {
        if (opts.command === "aws" && opts.args?.[0] === "sts") {
          stsKeys.push(opts.env?.AWS_SECRET_ACCESS_KEY ?? null);
        }
        return fakeExec()(opts);
      },
      promptAwsKeys: async () => {
        prompted = true;
        return {
          accessKeyId: "TESTACCESSKEYID12345",
          secretAccessKey: secret,
        };
      },
      promptAnswers: async ({ defaults }) => ({
        region: defaults.region,
        repository: defaults.repository,
        databaseUrl: "postgresql://localhost/db",
        databaseDriver: "postgres-js",
        databasePrepare: true,
        awsProfile: defaults.awsProfile,
        awsAccessKeyId: defaults.awsAccessKeyId,
        awsSecretAccessKey: defaults.awsSecretAccessKey,
        seed: false,
        deploy: false,
        extras: "skip",
      }),
      confirmDeploy: async () => false,
    }
  );

  assert.equal(code, 0);
  assert.equal(prompted, true);
  assert.deepEqual(stsKeys, [secret]);
  const body = await readFile(path.join(root, "cdk", ".deploy-env"), "utf8");
  assert.match(body, /AWS_ACCESS_KEY_ID="TESTACCESSKEYID12345"/);
  assert.match(body, /AWS_SECRET_ACCESS_KEY="test-secret-access-key-must-never-appear"/);
  const text = `${io.stdoutText}\n${io.stderrText}`;
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes("TESTACCESSKEYID12345"), false);
});

test("interactive init writes cdk/.deploy-env without asking where", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-no-envq-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  io.stdout.isTTY = true;
  io.stdin.isTTY = true;

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
      promptAnswers: async ({ defaults }) => ({
        region: defaults.region,
        repository: defaults.repository,
        databaseUrl: "postgresql://localhost/db",
        databaseDriver: "postgres-js",
        databasePrepare: true,
        awsProfile: defaults.awsProfile,
      }),
      confirmDeploy: async () => false,
    }
  );

  assert.equal(code, 0);
  assert.equal(existsSync(path.join(root, "cdk", ".deploy-env")), true);
  assert.match(io.stdoutText, /wrote cdk\/\.deploy-env/);
  const src = await readFile(
    new URL("../src/prompt.js", import.meta.url),
    "utf8"
  );
  assert.equal(src.includes("Write deploy-env to"), false);
  assert.equal(src.includes("~/.context101/deploy-env"), false);
  assert.equal(src.includes("deploy.sh"), false);
  assert.equal(src.includes("Optional last steps"), false);
  assert.equal(src.includes("Request access for all of these"), false);
  assert.equal(src.includes("Embedding models"), false);
  assert.match(io.stdoutText, /context101 deploy/);
  assert.equal(io.stdoutText.includes("Bedrock embedding access:"), false);
});

test("interactive --deploy-env still honors the flag", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-envflag-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  io.stdout.isTTY = true;
  io.stdin.isTTY = true;
  const envPath = path.join(root, "custom-secrets");

  const code = await main(
    [
      "init",
      "--database-url",
      "postgresql://localhost/db",
      "--force",
      "--deploy-env",
      envPath,
    ],
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
      promptAnswers: async ({ defaults }) => ({
        region: defaults.region,
        repository: defaults.repository,
        databaseUrl: "postgresql://localhost/db",
        databaseDriver: "postgres-js",
        databasePrepare: true,
        awsProfile: defaults.awsProfile,
      }),
      confirmDeploy: async () => false,
    }
  );

  assert.equal(code, 0);
  assert.equal(existsSync(envPath), true);
  assert.equal(existsSync(path.join(root, "cdk", ".deploy-env")), false);
});

test("--yes without a database URL writes CREATE_RDS", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-nodb-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const env = testEnv();
  const envPath = path.join(root, "cdk", ".deploy-env");

  const code = await main(["init", "--yes", "--force"], {
    cwd: root,
    env,
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(),
  });

  assert.equal(code, 0);
  const body = await readFile(envPath, "utf8");
  assert.match(body, /CREATE_RDS="true"/);
  assert.equal(body.includes("DATABASE_URL="), false);
  assert.match(io.stdoutText, /wrote cdk\/\.deploy-env/);
  assert.match(io.stdoutText, /context101 deploy/);
  assert.equal(io.stdoutText.includes("ControlPlaneDbSecretArn"), false);
  assert.equal(io.stdoutText.includes("BETTER_AUTH_URL"), false);
});
