import { chmod, mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path, { dirname } from "node:path";
import { upsertEnvLine } from "./config.js";
import { SMOOTH_REGION } from "./defaults.js";
import { findDeployEnvPath, parseEnvFile } from "./deploy-env-load.js";
import { createExec } from "./exec.js";
import { ownPublicUrl } from "./hosted-url.js";
import { helpText } from "./parse-args.js";
import { listSpaces, namePrefixForSpace, resolveSelectedSpace } from "./spaces.js";
import { writers } from "./style.js";

export const CONNECTOR_PROVIDERS = ["google", "notion", "github"];

export const CONNECTOR_CLIENT_SECRET_ENV = "CONTEXT101_CONNECTOR_CLIENT_SECRET";

export const OAUTH_CALLBACK_PATH = "/api/connectors/oauth/callback";
export const GITHUB_OAUTH_CALLBACK_PATH =
  "/api/connectors/github-app/oauth-callback";
export const GITHUB_SETUP_CALLBACK_PATH =
  "/api/connectors/github-app/setup-callback";

export const CONFIGURED_ACTIONS = ["update", "leave", "steps"];

const PROVIDER_META = {
  google: {
    label: "Google",
    envKey: "GOOGLE_OAUTH_CLIENT_SECRET_ID",
    secretSuffix: "google-oauth-client",
    description: "Context101 Google OAuth client (client_id + client_secret)",
  },
  notion: {
    label: "Notion",
    envKey: "NOTION_OAUTH_CLIENT_SECRET_ID",
    secretSuffix: "notion-oauth-client",
    description: "Context101 Notion OAuth client (client_id + client_secret)",
  },
  github: {
    label: "GitHub",
    envKey: "GITHUB_APP_SECRET_ID",
    secretSuffix: "connector-github-app",
    description: "Context101 GitHub App (app_id, client_id, client_secret, private_key)",
  },
};

export function parseConnectorProvider(raw) {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (CONNECTOR_PROVIDERS.includes(value)) return value;
  const err = new Error(
    "usage: context101 connectors setup <google|notion|github>"
  );
  err.code = "USAGE";
  throw err;
}

export function connectorProviderLabel(provider) {
  return PROVIDER_META[parseConnectorProvider(provider)].label;
}

export function connectorSecretName(provider, namePrefix = "context101") {
  const meta = PROVIDER_META[parseConnectorProvider(provider)];
  const prefix = String(namePrefix || "context101").trim() || "context101";
  return `${prefix}-${meta.secretSuffix}`;
}

export function connectorDeployEnvKey(provider) {
  return PROVIDER_META[parseConnectorProvider(provider)].envKey;
}

export function connectorStatusFromSignals({ envValue, secretExists } = {}) {
  const envSet = Boolean(String(envValue ?? "").trim());
  const smOk = Boolean(secretExists);
  return {
    configured: envSet || smOk,
    envSet,
    secretExists: smOk,
  };
}

export function formatProviderChoice({
  provider,
  configured,
  envKey,
} = {}) {
  const label = connectorProviderLabel(provider);
  const key = envKey || connectorDeployEnvKey(provider);
  if (!configured) return `${label} — not configured`;
  return `${label} — configured (${key})`;
}

export function formatConfiguredSummary({
  provider,
  envKey,
  secretName,
  region,
} = {}) {
  const label = connectorProviderLabel(provider);
  return [
    `${label} is configured`,
    `provider  ${label}`,
    `env key   ${envKey || connectorDeployEnvKey(provider)}`,
    `secret    ${secretName || ""}`,
    `region    ${region || ""}`,
  ].join("\n");
}

export function formatConfiguredActionChoices() {
  return [
    { name: "Update credentials", value: "update" },
    { name: "Leave as-is", value: "leave" },
    { name: "Show setup steps again", value: "steps" },
  ];
}

export function connectorAdminHost(values = {}) {
  const raw =
    ownPublicUrl(values.BETTER_AUTH_URL) || ownPublicUrl(values.APP_URL) || "";
  if (!raw) return "<admin>";
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.host || "<admin>";
  } catch {
    return "<admin>";
  }
}

export function connectorRedirectUri(
  adminHost = "<admin>",
  callbackPath = OAUTH_CALLBACK_PATH
) {
  const host =
    String(adminHost || "<admin>")
      .replace(/^https?:\/\//i, "")
      .replace(/\/$/, "") || "<admin>";
  const suffix = String(callbackPath || OAUTH_CALLBACK_PATH).startsWith("/")
    ? callbackPath
    : `/${callbackPath}`;
  return `https://${host}${suffix}`;
}

export function formatProviderSetupSteps(provider, { adminHost } = {}) {
  const host = adminHost || "<admin>";
  const oauth = connectorRedirectUri(host, OAUTH_CALLBACK_PATH);
  if (provider === "google") {
    return [
      "Create a Google Cloud OAuth Web client",
      "  APIs & Services → Credentials → Create OAuth client ID (Web application)",
      `  Redirect URI: ${oauth}`,
      "  Copy client_id and client_secret",
    ].join("\n");
  }
  if (provider === "notion") {
    return [
      "Create a Notion public integration",
      "  https://www.notion.so/my-integrations → New integration (Public)",
      `  Redirect URI: ${oauth}`,
      "  Copy OAuth client_id and client_secret",
    ].join("\n");
  }
  parseConnectorProvider(provider);
  return [
    "Create a GitHub App",
    "  Settings → Developer settings → GitHub Apps → New GitHub App",
    `  Callback URL: ${connectorRedirectUri(host, GITHUB_OAUTH_CALLBACK_PATH)}`,
    `  Setup URL: ${connectorRedirectUri(host, GITHUB_SETUP_CALLBACK_PATH)}`,
    `  Redirect URI: ${oauth}`,
    "  Permissions: Contents read/write, Metadata read. Generate a private key (PEM)",
    "  Copy App id, client_id, client_secret. A repo PAT is pasted in admin, not here.",
  ].join("\n");
}

export function oauthClientPayload({ clientId, clientSecret }) {
  const client_id = String(clientId ?? "").trim();
  const client_secret = String(clientSecret ?? "").trim();
  if (!client_id) {
    const err = new Error("need --client-id");
    err.code = "USAGE";
    throw err;
  }
  if (!client_secret) {
    const err = new Error(
      `need --client-secret or ${CONNECTOR_CLIENT_SECRET_ENV}`
    );
    err.code = "USAGE";
    throw err;
  }
  return { client_id, client_secret };
}

export function githubAppPayload({
  appId,
  clientId,
  clientSecret,
  privateKey,
  slug,
  htmlUrl,
}) {
  const oauth = oauthClientPayload({ clientId, clientSecret });
  const app_id = Number(appId);
  if (!Number.isInteger(app_id) || app_id <= 0) {
    const err = new Error("need --app-id (GitHub App id)");
    err.code = "USAGE";
    throw err;
  }
  const private_key = String(privateKey ?? "").trim();
  if (!private_key.includes("BEGIN") || !private_key.includes("PRIVATE KEY")) {
    const err = new Error("need --private-key-file (PEM)");
    err.code = "USAGE";
    throw err;
  }
  return {
    app_id,
    slug: String(slug ?? "").trim(),
    client_id: oauth.client_id,
    client_secret: oauth.client_secret,
    private_key,
    html_url: String(htmlUrl ?? "").trim(),
  };
}

export function formatConnectorSetupPlan({
  provider,
  secretName,
  envKey,
  dryRun = false,
  existed = false,
} = {}) {
  const verb = dryRun ? "would write" : existed ? "updated" : "wrote";
  const setVerb = dryRun ? "would set" : "set";
  return [
    `${verb} secret ${secretName}`,
    `${setVerb} ${envKey}`,
    "Next: context101 update",
    "Then: Add source → Connect in admin",
  ].join("\n");
}

function withAwsAuth(env, { profile, accessKeyId, secretAccessKey } = {}) {
  const next = { ...env };
  if (profile) next.AWS_PROFILE = profile;
  if (accessKeyId) next.AWS_ACCESS_KEY_ID = accessKeyId;
  if (secretAccessKey) next.AWS_SECRET_ACCESS_KEY = secretAccessKey;
  return next;
}

function usageError(message) {
  const err = new Error(message);
  err.code = "USAGE";
  throw err;
}

function isTty(ctx) {
  return Boolean(ctx.stdin?.isTTY && ctx.stdout?.isTTY);
}

export function secretExistsInManager({ exec, env, region, name } = {}) {
  if (!exec || !name) return false;
  try {
    const result = exec({
      command: "aws",
      args: [
        "secretsmanager",
        "describe-secret",
        "--secret-id",
        name,
        "--region",
        region || SMOOTH_REGION,
        "--output",
        "json",
      ],
      env,
    });
    return Boolean(result?.ok);
  } catch {
    return false;
  }
}

export async function runConnectors(opts, ctx) {
  const io = writers(ctx);
  if (opts.connectorsAction && opts.connectorsAction !== "setup") {
    io.err("usage: context101 connectors setup <google|notion|github>");
    return 1;
  }

  if (opts.connectorsAction === "setup") {
    return runConnectorSetup(opts, ctx, io);
  }

  if (!isTty(ctx)) {
    io.write(helpText("connectors"));
    return 0;
  }

  return runConnectorWizard(opts, ctx, io);
}

async function runConnectorSetup(opts, ctx, io) {
  let provider;
  try {
    provider = parseConnectorProvider(opts.connectorsProvider);
  } catch (error) {
    if (error && error.code === "USAGE") {
      io.err(error.message);
      return 1;
    }
    throw error;
  }

  const context = await loadSetupContext(opts, ctx);
  if (context.error) {
    io.err(context.error);
    return 1;
  }
  return writeConnectorFromOpts({
    provider,
    opts,
    ctx,
    io,
    ...context,
  });
}

async function runConnectorWizard(opts, ctx, io) {
  const context = await loadWizardContext(opts, ctx);
  if (context.error) {
    io.err(context.error);
    return 1;
  }

  const statuses = listProviderStatuses(context);
  const provider = await pickProvider(statuses, ctx);
  const row = statuses.find((item) => item.provider === provider);
  if (!row) {
    io.err("usage: context101 connectors setup <google|notion|github>");
    return 1;
  }

  const adminHost = connectorAdminHost(context.values);
  if (opts.dryRun) {
    return previewConnectorWizard({
      provider,
      row,
      adminHost,
      io,
      context,
    });
  }

  if (!row.configured) {
    writeLines(io, formatProviderSetupSteps(provider, { adminHost }));
    io.write("");
    return promptAndWrite({
      provider,
      opts,
      ctx,
      io,
      context,
    });
  }

  writeLines(io, formatConfiguredSummary(row));
  io.write("");

  while (true) {
    const action = await pickConfiguredAction(provider, ctx);
    if (action === "steps") {
      writeLines(io, formatProviderSetupSteps(provider, { adminHost }));
      io.write("");
      continue;
    }
    if (action === "leave") {
      io.ok("left as-is");
      io.write("");
      return 0;
    }
    if (action === "update") {
      return promptAndWrite({
        provider,
        opts,
        ctx,
        io,
        context,
      });
    }
    io.err("usage: context101 connectors setup <google|notion|github>");
    return 1;
  }
}

function previewConnectorWizard({ provider, row, adminHost, io, context }) {
  if (row.configured) {
    writeLines(io, formatConfiguredSummary(row));
    io.write("");
  }
  writeLines(io, formatProviderSetupSteps(provider, { adminHost }));
  io.write("");
  io.dim("dry-run — write nothing");
  io.write("");
  writePlan(
    io,
    formatConnectorSetupPlan({
      provider,
      secretName: row.secretName || connectorSecretName(provider, context.namePrefix),
      envKey: row.envKey || connectorDeployEnvKey(provider),
      dryRun: true,
    }),
    []
  );
  return 0;
}

async function promptAndWrite({ provider, opts, ctx, io, context }) {
  let fields;
  try {
    fields = await promptConnectorCredentials(provider, ctx);
  } catch (error) {
    if (error && error.code === "USAGE") {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
  return writeConnectorFromOpts({
    provider,
    opts: { ...opts, ...fields },
    ctx,
    io,
    ...context,
  });
}

async function loadSetupContext(opts, ctx) {
  const homeDir = ctx.homeDir ?? homedir();
  const spaces = listSpaces({ homeDir, cwd: ctx.cwd });
  const space = opts.space
    ? spaces.find((row) => row.name === String(opts.space).toLowerCase())
    : spaces.length === 1
      ? spaces[0]
      : null;
  if (opts.space && !space) {
    return { error: `unknown space ${opts.space}. Use \`context101 list\`.` };
  }
  return finishContext(opts, ctx, { homeDir, space });
}

async function loadWizardContext(opts, ctx) {
  const homeDir = ctx.homeDir ?? homedir();
  if (opts.envFile || opts.home) {
    return finishContext(opts, ctx, { homeDir, space: null });
  }
  let space;
  try {
    space = await resolveSelectedSpace(opts, { ...ctx, homeDir });
  } catch (error) {
    if (error && error.code === "USAGE") {
      return { error: error.message };
    }
    throw error;
  }
  return finishContext(opts, ctx, { homeDir, space });
}

async function finishContext(opts, ctx, { homeDir, space }) {
  const filePath = findDeployEnvPath({
    envFile: opts.envFile || space?.envPath,
    home: opts.home,
    cwd: ctx.cwd,
    homeDir,
  });
  if (!filePath) {
    return { error: "no deploy-env path. Pass --home or --deploy-env." };
  }

  const envText =
    existsSync(filePath) ? await readFile(filePath, "utf8") : "";
  const values = parseEnvFile(envText).values;
  const namePrefix =
    String(values.NAME_PREFIX || space?.namePrefix || "").trim() ||
    namePrefixForSpace(space?.name || "default");
  const region =
    String(values.AWS_REGION || space?.region || "").trim() || SMOOTH_REGION;
  const exec = ctx.exec ?? createExec(ctx.env);
  const awsEnv = withAwsAuth(ctx.env ?? {}, {
    profile: opts.awsProfile || space?.awsProfile || values.AWS_PROFILE,
    accessKeyId: opts.awsAccessKeyId || values.AWS_ACCESS_KEY_ID,
    secretAccessKey: opts.awsSecretAccessKey || values.AWS_SECRET_ACCESS_KEY,
  });
  return {
    filePath,
    envText,
    values,
    namePrefix,
    region,
    space,
    exec,
    awsEnv,
  };
}

function listProviderStatuses({
  values,
  namePrefix,
  exec,
  awsEnv,
  region,
}) {
  return CONNECTOR_PROVIDERS.map((provider) => {
    const envKey = connectorDeployEnvKey(provider);
    const envValue = String(values[envKey] || "").trim();
    const secretName = envValue || connectorSecretName(provider, namePrefix);
    const secretExists = secretExistsInManager({
      exec,
      env: awsEnv,
      region,
      name: secretName,
    });
    return {
      provider,
      envKey,
      secretName,
      region,
      envValue,
      ...connectorStatusFromSignals({ envValue, secretExists }),
    };
  });
}

async function pickProvider(statuses, ctx) {
  if (typeof ctx.chooseConnectorProvider === "function") {
    return parseConnectorProvider(await ctx.chooseConnectorProvider(statuses));
  }
  const { select } = await import("@inquirer/prompts");
  return select({
    message: "Provider",
    choices: statuses.map((row) => ({
      name: formatProviderChoice(row),
      value: row.provider,
    })),
  });
}

async function pickConfiguredAction(provider, ctx) {
  if (typeof ctx.chooseConfiguredAction === "function") {
    return ctx.chooseConfiguredAction(provider);
  }
  const { select } = await import("@inquirer/prompts");
  return select({
    message: `${connectorProviderLabel(provider)} is configured`,
    choices: formatConfiguredActionChoices(),
  });
}

export async function promptConnectorCredentials(provider, ctx = {}) {
  if (typeof ctx.promptConnectorFields === "function") {
    return ctx.promptConnectorFields(provider);
  }
  const { input, password } = await import("@inquirer/prompts");
  const clientId = await input({
    message: "client_id",
    validate: (value) => (String(value || "").trim() ? true : "needed"),
  });
  const clientSecret = await password({
    message: "client_secret",
    mask: true,
    validate: (value) => (value ? true : "needed"),
  });
  if (provider !== "github") {
    return { clientId, clientSecret };
  }
  const appId = await input({
    message: "app_id",
    validate: (value) => {
      const n = Number(value);
      return Number.isInteger(n) && n > 0 ? true : "need GitHub App id";
    },
  });
  const privateKeyFile = await input({
    message: "private-key-file (PEM)",
    validate: (value) => {
      const filePath = String(value || "").trim();
      if (!filePath) return "needed";
      if (!existsSync(filePath)) return "file not found";
      return true;
    },
  });
  const slug = await input({
    message: "slug (optional)",
    default: "",
  });
  const htmlUrl = await input({
    message: "html-url (optional)",
    default: "",
  });
  return { clientId, clientSecret, appId, privateKeyFile, slug, htmlUrl };
}

async function writeConnectorFromOpts({
  provider,
  opts,
  ctx,
  io,
  filePath,
  envText,
  namePrefix,
  region,
  exec,
  awsEnv,
}) {
  const secretName = connectorSecretName(provider, namePrefix);
  const envKey = connectorDeployEnvKey(provider);
  const meta = PROVIDER_META[provider];

  let payload;
  try {
    payload = await buildPayload(provider, opts, ctx);
  } catch (error) {
    if (error && error.code === "USAGE") {
      io.err(error.message);
      return 1;
    }
    throw error;
  }

  const secrets = collectPayloadSecrets(payload);

  if (opts.dryRun) {
    io.dim("dry-run — write nothing");
    io.write("");
    writePlan(
      io,
      formatConnectorSetupPlan({
        provider,
        secretName,
        envKey,
        dryRun: true,
      }),
      secrets
    );
    return 0;
  }

  let existed = false;
  try {
    existed = await putSecret({
      exec,
      env: awsEnv,
      region,
      name: secretName,
      description: meta.description,
      payload,
    });
  } catch (error) {
    io.err(error.message || "secretsmanager write failed");
    return 1;
  }

  const next = upsertEnvLine(envText, envKey, secretName);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, next, { encoding: "utf8", mode: 0o600 });
  await chmod(filePath, 0o600);

  writePlan(
    io,
    formatConnectorSetupPlan({
      provider,
      secretName,
      envKey,
      dryRun: false,
      existed,
    }),
    secrets
  );
  return 0;
}

function writeLines(io, text) {
  for (const line of String(text || "").split("\n")) io.write(line);
}

function writePlan(io, text, secrets) {
  for (const secret of secrets) {
    if (secret && text.includes(secret)) {
      throw new Error("connectors setup leaked a secret");
    }
  }
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("Next:") || line.startsWith("Then:")) io.write(line);
    else if (
      line.startsWith("would ") ||
      line.startsWith("wrote ") ||
      line.startsWith("updated ") ||
      line.startsWith("set ") ||
      line.startsWith("would set ")
    ) {
      io.ok(line);
    } else {
      io.write(line);
    }
  }
  io.write("");
}

function collectPayloadSecrets(payload) {
  const secrets = [];
  if (payload.client_secret) secrets.push(payload.client_secret);
  if (payload.private_key) secrets.push(payload.private_key);
  return secrets;
}

async function resolveClientSecret(opts, ctx) {
  const fromFlag = String(opts.clientSecret || "").trim();
  if (fromFlag) return fromFlag;
  const fromEnv = String(ctx.env?.[CONNECTOR_CLIENT_SECRET_ENV] || "").trim();
  if (fromEnv) return fromEnv;
  if (!isTty(ctx)) {
    usageError(`need --client-secret or ${CONNECTOR_CLIENT_SECRET_ENV}`);
  }
  const { password } = await import("@inquirer/prompts");
  return password({
    message: "client_secret",
    mask: true,
    validate: (value) => (value ? true : "needed"),
  });
}

async function buildPayload(provider, opts, ctx) {
  const clientId = String(opts.clientId || "").trim();
  const clientSecret = await resolveClientSecret(opts, ctx);

  if (provider === "github") {
    const privateKey = opts.privateKeyFile
      ? await readFile(opts.privateKeyFile, "utf8")
      : "";
    return githubAppPayload({
      appId: opts.appId,
      clientId,
      clientSecret,
      privateKey,
      slug: opts.slug,
      htmlUrl: opts.htmlUrl,
    });
  }

  if (opts.appId || opts.privateKeyFile || opts.slug || opts.htmlUrl) {
    usageError("--app-id / --private-key-file / --slug / --html-url are GitHub App flags");
  }
  return oauthClientPayload({ clientId, clientSecret });
}

async function putSecret({ exec, env, region, name, description, payload }) {
  const dir = await mkdtemp(path.join(tmpdir(), "ctx101-sm-"));
  const filePath = path.join(dir, "secret.json");
  await writeFile(filePath, JSON.stringify(payload), {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    const describe = exec({
      command: "aws",
      args: [
        "secretsmanager",
        "describe-secret",
        "--secret-id",
        name,
        "--region",
        region,
        "--output",
        "json",
      ],
      env,
    });
    const existed = describe.ok;
    const args = existed
      ? [
          "secretsmanager",
          "put-secret-value",
          "--secret-id",
          name,
          "--region",
          region,
          "--secret-string",
          `file://${filePath}`,
        ]
      : [
          "secretsmanager",
          "create-secret",
          "--name",
          name,
          "--region",
          region,
          "--description",
          description,
          "--secret-string",
          `file://${filePath}`,
        ];
    const result = exec({ command: "aws", args, env, timeout: 30_000 });
    if (!result.ok) {
      const err = new Error(
        result.stderr || result.stdout || "secretsmanager write failed"
      );
      throw err;
    }
    return existed;
  } finally {
    await unlink(filePath).catch(() => {});
  }
}
