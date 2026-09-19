import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  CONNECTOR_CLIENT_SECRET_ENV,
  CONNECTOR_PROVIDERS,
  connectorAdminHost,
  connectorDeployEnvKey,
  connectorRedirectUri,
  connectorSecretName,
  connectorStatusFromSignals,
  formatConfiguredActionChoices,
  formatConfiguredSummary,
  formatConnectorSetupPlan,
  formatProviderChoice,
  formatProviderSetupSteps,
  githubAppPayload,
  oauthClientPayload,
  parseConnectorProvider,
  secretExistsInManager,
} from "../src/connectors.js";
import { SMOOTH_REGION } from "../src/defaults.js";
import { helpText, parseArgs } from "../src/parse-args.js";
import { main } from "./run-main.js";
import { fakeExec, makeRepoFixture, memoryIo, tempHome, testEnv, writeTestDeployEnv } from "./helpers.js";

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
  const bare = parseArgs(["connectors"]);
  assert.equal(bare.help, false);
  assert.equal(bare.command, "connectors");
  assert.equal(bare.connectorsAction, null);
  assert.equal(parseArgs(["connectors", "acme"]).space, "acme");
  assert.equal(parseArgs(["connectors", "--help"]).help, true);
  assert.equal(parseArgs(["help", "connectors"]).helpTopic, "connectors");
  assert.equal(parseArgs(["help", "connectors", "setup"]).helpTopic, "connectors setup");
  assert.throws(() => parseArgs(["init", "--client-id", "x"]), /connectors option/);
});

test("help lists connectors wizard and never shows a fake secret", () => {
  const text = helpText();
  assert.match(text, /connectors setup/);
  assert.match(text, /TTY wizard/);
  assert.equal(text.includes(CLIENT_SECRET), false);
  const topic = helpText("connectors");
  assert.match(topic, /Secrets Manager/);
  assert.match(topic, /CONTEXT101_CONNECTOR_CLIENT_SECRET/);
  assert.match(topic, /TTY wizard/);
  assert.match(topic, /Not configured/);
  assert.match(topic, /update \/ leave \/ show steps/);
  assert.equal(topic.includes("client_secret="), false);
  assert.equal(topic.includes(CLIENT_SECRET), false);
});

function smExec({ describeOk = false, describeNames = null } = {}) {
  const calls = [];
  const inner = fakeExec();
  return {
    calls,
    exec({ command, args = [], env, cwd, timeout } = {}) {
      calls.push({ command, args: [...args] });
      if (command === "aws" && args[0] === "secretsmanager") {
        if (args[1] === "describe-secret") {
          const id = args[args.indexOf("--secret-id") + 1];
          const ok =
            describeNames != null
              ? describeNames.has(id)
              : describeOk;
          if (ok) {
            return { ok: true, code: 0, stdout: '{"Name":"ok"}', stderr: "", error: null };
          }
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

test("status is env key and/or SM describe, never a secret value", () => {
  assert.deepEqual(connectorStatusFromSignals({ envValue: "", secretExists: false }), {
    configured: false,
    envSet: false,
    secretExists: false,
  });
  assert.equal(
    connectorStatusFromSignals({
      envValue: "context101-google-oauth-client",
      secretExists: false,
    }).configured,
    true
  );
  assert.equal(
    connectorStatusFromSignals({ envValue: "", secretExists: true }).configured,
    true
  );
  assert.equal(
    connectorStatusFromSignals({ envValue: "   ", secretExists: false }).configured,
    false
  );
  const missing = smExec();
  assert.equal(
    secretExistsInManager({
      exec: missing.exec,
      env: {},
      region: SMOOTH_REGION,
      name: "context101-google-oauth-client",
    }),
    false
  );
  const present = smExec({ describeOk: true });
  assert.equal(
    secretExistsInManager({
      exec: present.exec,
      env: {},
      region: SMOOTH_REGION,
      name: "context101-google-oauth-client",
    }),
    true
  );
  assert.equal(
    present.calls.every((call) => call.args[1] === "describe-secret"),
    true
  );
  assert.equal(
    present.calls.some((call) => call.args.includes("get-secret-value")),
    false
  );
});

test("menu plan formatting shows names only and never leaks secrets", () => {
  assert.equal(
    formatProviderChoice({
      provider: "google",
      configured: false,
      envKey: "GOOGLE_OAUTH_CLIENT_SECRET_ID",
    }),
    "Google — not configured"
  );
  assert.equal(
    formatProviderChoice({
      provider: "google",
      configured: true,
      envKey: "GOOGLE_OAUTH_CLIENT_SECRET_ID",
    }),
    "Google — configured (GOOGLE_OAUTH_CLIENT_SECRET_ID)"
  );
  assert.equal(
    formatProviderChoice({
      provider: "notion",
      configured: true,
      envKey: "NOTION_OAUTH_CLIENT_SECRET_ID",
    }),
    "Notion — configured (NOTION_OAUTH_CLIENT_SECRET_ID)"
  );
  assert.equal(
    formatProviderChoice({
      provider: "github",
      configured: false,
      envKey: "GITHUB_APP_SECRET_ID",
    }),
    "GitHub — not configured"
  );
  const summary = formatConfiguredSummary({
    provider: "notion",
    envKey: "NOTION_OAUTH_CLIENT_SECRET_ID",
    secretName: "context101-notion-oauth-client",
    region: SMOOTH_REGION,
  });
  assert.match(summary, /Notion is configured/);
  assert.match(summary, /NOTION_OAUTH_CLIENT_SECRET_ID/);
  assert.match(summary, /context101-notion-oauth-client/);
  assert.match(summary, new RegExp(SMOOTH_REGION));
  assert.equal(summary.includes(CLIENT_SECRET), false);
  const plan = CONNECTOR_PROVIDERS.map((provider) =>
    formatProviderChoice({
      provider,
      configured: true,
      envKey: connectorDeployEnvKey(provider),
    })
  ).join("\n");
  assert.equal(plan.includes(CLIENT_SECRET), false);
  assert.equal(plan.includes("BEGIN"), false);
  assert.equal(plan.includes("test-pem-must-never-appear"), false);
  const actions = formatConfiguredActionChoices();
  assert.deepEqual(
    actions.map((row) => row.value),
    ["update", "leave", "steps"]
  );
  assert.equal(JSON.stringify(actions).includes(CLIENT_SECRET), false);
});

test("setup steps include redirect URI hints and never print secrets", () => {
  assert.equal(connectorAdminHost({}), "<admin>");
  assert.equal(
    connectorAdminHost({ BETTER_AUTH_URL: "https://kb.example.com" }),
    "kb.example.com"
  );
  assert.equal(
    connectorRedirectUri("<admin>"),
    "https://<admin>/api/connectors/oauth/callback"
  );
  const google = formatProviderSetupSteps("google");
  const notion = formatProviderSetupSteps("notion");
  const github = formatProviderSetupSteps("github", {
    adminHost: "admin.example.com",
  });
  assert.match(google, /Google Cloud OAuth Web client/);
  assert.match(google, /https:\/\/<admin>\/api\/connectors\/oauth\/callback/);
  assert.match(notion, /Notion public integration/);
  assert.match(github, /GitHub App/);
  assert.match(
    github,
    /https:\/\/admin\.example\.com\/api\/connectors\/github-app\/oauth-callback/
  );
  assert.match(
    github,
    /https:\/\/admin\.example\.com\/api\/connectors\/github-app\/setup-callback/
  );
  for (const text of [google, notion, github]) {
    assert.equal(text.includes(CLIENT_SECRET), false);
    assert.equal(text.includes("test-pem-must-never-appear"), false);
    assert.equal(text.includes("ghp_"), false);
  }
});

test("non-TTY context101 connectors prints help and exits 0", async () => {
  const io = memoryIo();
  const sm = smExec();
  const code = await main(["connectors"], {
    cwd: "/tmp",
    env: testEnv({ [CONNECTOR_CLIENT_SECRET_ENV]: CLIENT_SECRET }),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: sm.exec,
  });
  assert.equal(code, 0);
  assert.match(io.stdoutText, /connectors setup <google\|notion\|github>/);
  assert.match(io.stdoutText, /TTY wizard/);
  assert.equal(io.stdoutText.includes(CLIENT_SECRET), false);
  assert.equal(io.stderrText.includes(CLIENT_SECRET), false);
  assert.equal(
    sm.calls.some((call) => call.command === "aws"),
    false
  );
});

function ttyIo() {
  const io = memoryIo();
  io.stdout.isTTY = true;
  io.stdin.isTTY = true;
  return io;
}

test("TTY wizard sets up an unconfigured provider without printing secrets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-conn-wiz-"));
  const home = await tempHome();
  await makeRepoFixture(root);
  await writeTestDeployEnv(root);
  const io = ttyIo();
  const sm = smExec();
  const seen = [];
  const code = await main(["connectors"], {
    cwd: root,
    homeDir: home,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: sm.exec,
    chooseConnectorProvider: async (statuses) => {
      seen.push(statuses.map((row) => formatProviderChoice(row)));
      return "google";
    },
    promptConnectorFields: async () => ({
      clientId: "cid.apps.googleusercontent.com",
      clientSecret: CLIENT_SECRET,
    }),
  });
  assert.equal(code, 0);
  assert.match(seen[0][0], /Google — not configured/);
  assert.match(io.stdoutText, /Google Cloud OAuth Web client/);
  assert.match(io.stdoutText, /https:\/\/<admin>\/api\/connectors\/oauth\/callback/);
  assert.match(io.stdoutText, /wrote secret context101-google-oauth-client/);
  assert.match(io.stdoutText, /set GOOGLE_OAUTH_CLIENT_SECRET_ID/);
  assert.equal(io.stdoutText.includes(CLIENT_SECRET), false);
  assert.equal(io.stderrText.includes(CLIENT_SECRET), false);
  const create = sm.calls.find(
    (call) => call.command === "aws" && call.args[1] === "create-secret"
  );
  assert.ok(create);
  assert.equal(create.args.includes(CLIENT_SECRET), false);
  const body = await readFile(path.join(root, "cdk", ".deploy-env"), "utf8");
  assert.match(body, /GOOGLE_OAUTH_CLIENT_SECRET_ID="context101-google-oauth-client"/);
  assert.equal(body.includes(CLIENT_SECRET), false);
});

test("TTY wizard shows a configured provider and can leave as-is", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-conn-leave-"));
  const home = await tempHome();
  await makeRepoFixture(root);
  await writeTestDeployEnv(
    root,
    'GOOGLE_OAUTH_CLIENT_SECRET_ID="context101-google-oauth-client"'
  );
  const io = ttyIo();
  const sm = smExec();
  const code = await main(["connectors"], {
    cwd: root,
    homeDir: home,
    env: testEnv({ [CONNECTOR_CLIENT_SECRET_ENV]: CLIENT_SECRET }),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: sm.exec,
    chooseConnectorProvider: async () => "google",
    chooseConfiguredAction: async () => "leave",
    promptConnectorFields: async () => {
      throw new Error("leave as-is must not prompt for credentials");
    },
  });
  assert.equal(code, 0);
  assert.match(io.stdoutText, /Google is configured/);
  assert.match(io.stdoutText, /GOOGLE_OAUTH_CLIENT_SECRET_ID/);
  assert.match(io.stdoutText, /context101-google-oauth-client/);
  assert.match(io.stdoutText, /left as-is/);
  assert.equal(io.stdoutText.includes(CLIENT_SECRET), false);
  assert.equal(
    sm.calls.some((call) => ["create-secret", "put-secret-value"].includes(call.args[1])),
    false
  );
  assert.equal(
    sm.calls.some((call) => call.args.includes("get-secret-value")),
    false
  );
});

test("TTY wizard updates an existing SM secret without printing it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-conn-upd-"));
  const home = await tempHome();
  await makeRepoFixture(root);
  await writeTestDeployEnv(
    root,
    'GOOGLE_OAUTH_CLIENT_SECRET_ID="context101-google-oauth-client"'
  );
  const io = ttyIo();
  const sm = smExec({
    describeNames: new Set(["context101-google-oauth-client"]),
  });
  const code = await main(["connectors"], {
    cwd: root,
    homeDir: home,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: sm.exec,
    chooseConnectorProvider: async () => "google",
    chooseConfiguredAction: async () => "update",
    promptConnectorFields: async () => ({
      clientId: "cid.apps.googleusercontent.com",
      clientSecret: CLIENT_SECRET,
    }),
  });
  assert.equal(code, 0);
  assert.match(io.stdoutText, /Google is configured/);
  assert.match(io.stdoutText, /updated secret context101-google-oauth-client/);
  assert.equal(io.stdoutText.includes(CLIENT_SECRET), false);
  const put = sm.calls.find(
    (call) => call.command === "aws" && call.args[1] === "put-secret-value"
  );
  assert.ok(put);
  const secretArg = put.args[put.args.indexOf("--secret-string") + 1];
  assert.match(secretArg, /^file:\/\//);
  assert.equal(put.args.includes(CLIENT_SECRET), false);
  assert.equal(
    sm.calls.some((call) => call.args.includes("get-secret-value")),
    false
  );
});

test("TTY wizard can reprint setup steps without writing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-conn-steps-"));
  const home = await tempHome();
  await makeRepoFixture(root);
  await writeTestDeployEnv(
    root,
    'GITHUB_APP_SECRET_ID="context101-connector-github-app"'
  );
  const io = ttyIo();
  const sm = smExec({ describeOk: true });
  let n = 0;
  const code = await main(["connectors"], {
    cwd: root,
    homeDir: home,
    env: testEnv({ [CONNECTOR_CLIENT_SECRET_ENV]: CLIENT_SECRET }),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: sm.exec,
    chooseConnectorProvider: async () => "github",
    chooseConfiguredAction: async () => {
      n += 1;
      return n === 1 ? "steps" : "leave";
    },
    promptConnectorFields: async () => {
      throw new Error("docs-only steps must not prompt for credentials");
    },
  });
  assert.equal(code, 0);
  assert.match(io.stdoutText, /GitHub is configured/);
  assert.match(io.stdoutText, /Create a GitHub App/);
  assert.match(
    io.stdoutText,
    /https:\/\/<admin>\/api\/connectors\/github-app\/oauth-callback/
  );
  assert.match(io.stdoutText, /left as-is/);
  assert.equal(io.stdoutText.includes(CLIENT_SECRET), false);
  assert.equal(io.stdoutText.includes("test-pem-must-never-appear"), false);
  assert.equal(
    sm.calls.some((call) => ["create-secret", "put-secret-value"].includes(call.args[1])),
    false
  );
});

test("TTY wizard treats SM describe success as configured without an env key", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-conn-sm-"));
  const home = await tempHome();
  await makeRepoFixture(root);
  await writeTestDeployEnv(root);
  const io = ttyIo();
  const sm = smExec({
    describeNames: new Set(["context101-google-oauth-client"]),
  });
  const seen = [];
  const code = await main(["connectors"], {
    cwd: root,
    homeDir: home,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: sm.exec,
    chooseConnectorProvider: async (statuses) => {
      seen.push(statuses.find((row) => row.provider === "google"));
      return "google";
    },
    chooseConfiguredAction: async () => "leave",
  });
  assert.equal(code, 0);
  assert.equal(seen[0].configured, true);
  assert.equal(seen[0].secretExists, true);
  assert.match(io.stdoutText, /Google — configured \(GOOGLE_OAUTH_CLIENT_SECRET_ID\)|Google is configured/);
  assert.match(io.stdoutText, /left as-is/);
});

test("TTY wizard picks a space when several exist", async () => {
  const home = await tempHome();
  const empty = await mkdtemp(path.join(tmpdir(), "ctx101-conn-spaces-"));
  for (const name of ["findit", "platea"]) {
    const dir = path.join(home, ".context101", "spaces", name);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "deploy-env"),
      [
        'CTX_TOKEN="ctx_testtoken_xx"',
        'APP_MODE="self_hosted"',
        `GOOGLE_OAUTH_CLIENT_SECRET_ID="context101-${name}-google-oauth-client"`,
        "",
      ].join("\n"),
      { mode: 0o600 }
    );
  }
  const io = ttyIo();
  const sm = smExec();
  const picked = [];
  const code = await main(["connectors"], {
    cwd: empty,
    homeDir: home,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: sm.exec,
    chooseSpace: async (spaces) => {
      picked.push(spaces.map((space) => space.name));
      return "platea";
    },
    chooseConnectorProvider: async (statuses) => {
      picked.push(statuses.find((row) => row.provider === "google").secretName);
      return "google";
    },
    chooseConfiguredAction: async () => "leave",
  });
  assert.equal(code, 0);
  assert.deepEqual(picked[0], ["findit", "platea"]);
  assert.equal(picked[1], "context101-platea-google-oauth-client");
  assert.match(io.stdoutText, /Google is configured/);
  assert.match(io.stdoutText, /context101-platea-google-oauth-client/);
  assert.equal(io.stdoutText.includes(CLIENT_SECRET), false);
});
