import { chmod, mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path, { dirname } from "node:path";
import { upsertEnvLine } from "./config.js";
import { SMOOTH_REGION } from "./defaults.js";
import { findDeployEnvPath, parseEnvFile } from "./deploy-env-load.js";
import { createExec } from "./exec.js";
import { listSpaces, namePrefixForSpace } from "./spaces.js";
import { writers } from "./style.js";

export const CONNECTOR_PROVIDERS = ["google", "notion", "github"];

export const CONNECTOR_CLIENT_SECRET_ENV = "CONTEXT101_CONNECTOR_CLIENT_SECRET";

const PROVIDER_META = {
  google: {
    envKey: "GOOGLE_OAUTH_CLIENT_SECRET_ID",
    secretSuffix: "google-oauth-client",
    description: "Context101 Google OAuth client (client_id + client_secret)",
  },
  notion: {
    envKey: "NOTION_OAUTH_CLIENT_SECRET_ID",
    secretSuffix: "notion-oauth-client",
    description: "Context101 Notion OAuth client (client_id + client_secret)",
  },
  github: {
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

export function connectorSecretName(provider, namePrefix = "context101") {
  const meta = PROVIDER_META[parseConnectorProvider(provider)];
  const prefix = String(namePrefix || "context101").trim() || "context101";
  return `${prefix}-${meta.secretSuffix}`;
}

export function connectorDeployEnvKey(provider) {
  return PROVIDER_META[parseConnectorProvider(provider)].envKey;
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

export async function runConnectors(opts, ctx) {
  const io = writers(ctx);
  if (opts.connectorsAction !== "setup") {
    io.err("usage: context101 connectors setup <google|notion|github>");
    return 1;
  }

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

  const homeDir = ctx.homeDir ?? homedir();
  const spaces = listSpaces({ homeDir, cwd: ctx.cwd });
  const space = opts.space
    ? spaces.find((row) => row.name === String(opts.space).toLowerCase())
    : spaces.length === 1
      ? spaces[0]
      : null;
  if (opts.space && !space) {
    io.err(`unknown space ${opts.space}. Use \`context101 list\`.`);
    return 1;
  }
  const filePath = findDeployEnvPath({
    envFile: opts.envFile || space?.envPath,
    home: opts.home,
    cwd: ctx.cwd,
    homeDir,
  });

  const envText =
    filePath && existsSync(filePath) ? await readFile(filePath, "utf8") : "";
  const values = parseEnvFile(envText).values;
  const namePrefix =
    String(values.NAME_PREFIX || space?.namePrefix || "").trim() ||
    namePrefixForSpace(space?.name || "default");
  const secretName = connectorSecretName(provider, namePrefix);
  const envKey = connectorDeployEnvKey(provider);
  const meta = PROVIDER_META[provider];
  const region =
    String(values.AWS_REGION || space?.region || "").trim() || SMOOTH_REGION;

  if (!filePath) {
    io.err("no deploy-env path. Pass --home or --deploy-env.");
    return 1;
  }

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

  const exec = ctx.exec ?? createExec(ctx.env);
  const awsEnv = withAwsAuth(ctx.env ?? {}, {
    profile: opts.awsProfile || space?.awsProfile || values.AWS_PROFILE,
    accessKeyId: opts.awsAccessKeyId || values.AWS_ACCESS_KEY_ID,
    secretAccessKey: opts.awsSecretAccessKey || values.AWS_SECRET_ACCESS_KEY,
  });

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
  const tty = Boolean(ctx.stdin?.isTTY && ctx.stdout?.isTTY);
  if (!tty) {
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
