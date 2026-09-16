import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  CONNECTOR_CLIENT_SECRET_ENV,
  connectorDeployEnvKey,
  connectorSecretName,
  formatConnectorSetupPlan,
  githubAppPayload,
  oauthClientPayload,
  parseConnectorProvider,
} from "../src/connectors.js";
import { helpText, parseArgs } from "../src/parse-args.js";
import { main } from "./run-main.js";
import { fakeExec, makeRepoFixture, memoryIo, testEnv, writeTestDeployEnv } from "./helpers.js";

const CLIENT_SECRET = "oauth-client-secret-must-never-appear";
const PEM = `-----BEGIN RSA PRIVATE KEY-----
test-pem-must-never-appear
-----END RSA PRIVATE KEY-----
`;

test("provider names and SM names stay ids, not values", () => {
  assert.deepEqual(
    ["google", "notion", "github"].map(parseConnectorProvider),
    ["google", "notion", "github"]
  );
  assert.throws(() => parseConnectorProvider("slack"), /google\|notion\|github/);
  assert.equal(connectorSecretName("google", "context101"), "context101-google-oauth-client");
  assert.equal(connectorSecretName("notion", "context101-acme"), "context101-acme-notion-oauth-client");
  assert.equal(
    connectorSecretName("github", "context101"),
    "context101-connector-github-app"
  );
  assert.equal(connectorDeployEnvKey("google"), "GOOGLE_OAUTH_CLIENT_SECRET_ID");
  assert.equal(connectorDeployEnvKey("github"), "GITHUB_APP_SECRET_ID");
});

test("payload builders never put secrets in the plan text", () => {
  const oauth = oauthClientPayload({
    clientId: "google-client-id.apps.googleusercontent.com",
    clientSecret: CLIENT_SECRET,
  });
  const plan = formatConnectorSetupPlan({
    provider: "google",
    secretName: "context101-google-oauth-client",
    envKey: "GOOGLE_OAUTH_CLIENT_SECRET_ID",
    dryRun: true,
  });
  assert.equal(plan.includes(CLIENT_SECRET), false);
  assert.match(plan, /would write secret context101-google-oauth-client/);
  assert.match(plan, /GOOGLE_OAUTH_CLIENT_SECRET_ID/);
  assert.match(plan, /context101 update/);
  assert.equal(oauth.client_secret, CLIENT_SECRET);

  const app = githubAppPayload({
    appId: "12345",
    clientId: "Iv1.example",
    clientSecret: CLIENT_SECRET,
    privateKey: PEM,
    slug: "context101",
  });
  assert.equal(app.app_id, 12345);
  const ghPlan = formatConnectorSetupPlan({
    provider: "github",
    secretName: "context101-connector-github-app",
    envKey: "GITHUB_APP_SECRET_ID",
  });
  assert.equal(ghPlan.includes(CLIENT_SECRET), false);
  assert.equal(ghPlan.includes("test-pem-must-never-appear"), false);
});

test("parses connectors setup and help topic", () => {
  const opts = parseArgs([
    "connectors",
    "setup",
    "google",
    "acme",
    "--client-id",
    "cid.apps.googleusercontent.com",
    "--dry-run",
    "--aws-profile",
    "findit",
  ]);
  assert.equal(opts.command, "connectors");
  assert.equal(opts.connectorsAction, "setup");
  assert.equal(opts.connectorsProvider, "google");
  assert.equal(opts.space, "acme");
  assert.equal(opts.clientId, "cid.apps.googleusercontent.com");
  assert.equal(opts.dryRun, true);
  assert.equal(opts.awsProfile, "findit");
  assert.equal(parseArgs(["connectors"]).help, true);
  assert.equal(parseArgs(["help", "connectors"]).helpTopic, "connectors");
  assert.equal(parseArgs(["help", "connectors", "setup"]).helpTopic, "connectors setup");
  assert.throws(() => parseArgs(["init", "--client-id", "x"]), /connectors option/);
});

test("help lists connectors setup and never shows a fake secret", () => {
  const text = helpText();
  assert.match(text, /connectors setup/);
  assert.equal(text.includes(CLIENT_SECRET), false);
  assert.match(helpText("connectors"), /Secrets Manager/);
  assert.match(helpText("connectors"), /CONTEXT101_CONNECTOR_CLIENT_SECRET/);
  assert.equal(helpText("connectors").includes("client_secret="), false);
});

function smExec() {
  const calls = [];
  const inner = fakeExec();
  return {
    calls,
    exec({ command, args = [], env, cwd, timeout } = {}) {
      calls.push({ command, args: [...args] });
      if (command === "aws" && args[0] === "secretsmanager") {
        if (args[1] === "describe-secret") {
          return {
            ok: false,
            code: 254,
            stdout: "",
            stderr: "ResourceNotFoundException",
            error: null,
          };
        }
        return { ok: true, code: 0, stdout: '{"Name":"ok"}', stderr: "", error: null };
      }
      return inner({ command, args, env, cwd, timeout });
    },
  };
}

test("context101 connectors setup google --dry-run never prints the secret", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-conn-dry-"));
  await makeRepoFixture(root);
  await writeTestDeployEnv(root);
  const io = memoryIo();
  const sm = smExec();
  const code = await main(
    [
      "connectors",
      "setup",
      "google",
      "--dry-run",
      "--client-id",
      "cid.apps.googleusercontent.com",
      "--client-secret",
      CLIENT_SECRET,
    ],
    {
      cwd: root,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: sm.exec,
    }
  );
  assert.equal(code, 0);
  assert.match(io.stdoutText, /dry-run — write nothing/);
  assert.match(io.stdoutText, /would write secret context101-google-oauth-client/);
  assert.match(io.stdoutText, /GOOGLE_OAUTH_CLIENT_SECRET_ID/);
  assert.equal(io.stdoutText.includes(CLIENT_SECRET), false);
  assert.equal(io.stderrText.includes(CLIENT_SECRET), false);
  assert.equal(sm.calls.some((c) => c.command === "aws"), false);
  const body = await readFile(path.join(root, "cdk", ".deploy-env"), "utf8");
  assert.equal(body.includes("GOOGLE_OAUTH_CLIENT_SECRET_ID"), false);
});

test("context101 connectors setup google writes SM via file:// and the env id", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-conn-write-"));
  await makeRepoFixture(root);
  await writeTestDeployEnv(root);
  const io = memoryIo();
  const sm = smExec();
  const code = await main(
    [
      "connectors",
      "setup",
      "google",
      "--client-id",
      "cid.apps.googleusercontent.com",
      "--client-secret",
      CLIENT_SECRET,
    ],
    {
      cwd: root,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: sm.exec,
    }
  );
  assert.equal(code, 0);
  assert.match(io.stdoutText, /wrote secret context101-google-oauth-client/);
  assert.match(io.stdoutText, /set GOOGLE_OAUTH_CLIENT_SECRET_ID/);
  assert.equal(io.stdoutText.includes(CLIENT_SECRET), false);
  const create = sm.calls.find(
    (c) => c.command === "aws" && c.args[1] === "create-secret"
  );
  assert.ok(create);
  const secretArg = create.args[create.args.indexOf("--secret-string") + 1];
  assert.match(secretArg, /^file:\/\//);
  assert.equal(create.args.includes(CLIENT_SECRET), false);
  const body = await readFile(path.join(root, "cdk", ".deploy-env"), "utf8");
  assert.match(body, /GOOGLE_OAUTH_CLIENT_SECRET_ID="context101-google-oauth-client"/);
  assert.equal(body.includes(CLIENT_SECRET), false);
});

test("context101 connectors setup github reads PEM and never prints it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-conn-gh-"));
  await makeRepoFixture(root);
  await writeTestDeployEnv(root);
  const pemPath = path.join(root, "app.pem");
  await writeFile(pemPath, PEM, { encoding: "utf8", mode: 0o600 });
  const io = memoryIo();
  const sm = smExec();
  const code = await main(
    [
      "connectors",
      "setup",
      "github",
      "--app-id",
      "42",
      "--client-id",
      "Iv1.example",
      "--private-key-file",
      pemPath,
    ],
    {
      cwd: root,
      env: testEnv({ [CONNECTOR_CLIENT_SECRET_ENV]: CLIENT_SECRET }),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: sm.exec,
    }
  );
  assert.equal(code, 0);
  assert.match(io.stdoutText, /wrote secret context101-connector-github-app/);
  assert.match(io.stdoutText, /set GITHUB_APP_SECRET_ID/);
  assert.equal(io.stdoutText.includes(CLIENT_SECRET), false);
  assert.equal(io.stdoutText.includes("test-pem-must-never-appear"), false);
  const create = sm.calls.find(
    (c) => c.command === "aws" && c.args[1] === "create-secret"
  );
  const secretArg = create.args[create.args.indexOf("--secret-string") + 1];
  assert.match(secretArg, /^file:\/\//);
  const body = await readFile(path.join(root, "cdk", ".deploy-env"), "utf8");
  assert.match(body, /GITHUB_APP_SECRET_ID="context101-connector-github-app"/);
});

test("cdk/.deploy-env.example documents connector ids without fake secrets", async () => {
  const { fileURLToPath } = await import("node:url");
  const examplePath = fileURLToPath(
    new URL("../../../cdk/.deploy-env.example", import.meta.url)
  );
  const text = await readFile(examplePath, "utf8");
  assert.match(text, /GOOGLE_OAUTH_CLIENT_SECRET_ID="context101-google-oauth-client"/);
  assert.match(text, /NOTION_OAUTH_CLIENT_SECRET_ID="context101-notion-oauth-client"/);
  assert.match(text, /GITHUB_APP_SECRET_ID="context101-connector-github-app"/);
  assert.match(text, /context101 connectors setup/);
  assert.equal(text.includes("client_secret="), false);
  assert.equal(/ghp_[A-Za-z0-9]/.test(text), false);
});
