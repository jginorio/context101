import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import {
  classifyGithubToken,
  githubTokenWorksForAmplify,
} from "./checks.js";
import { printCancelled, SIGINT_EXIT } from "./cancel.js";
import { ensureCheckoutDeps, resolveCdkBin } from "./checkout-deps.js";
import { actionLabel } from "./progress.js";
import { formatQuietFailure, formatQuietSuccess, secretsFromContext } from "./quiet.js";
import { findDeployEnvPath, readDeployEnvFile } from "./deploy-env-load.js";
import { displaySpaceEnv } from "./spaces.js";
import { isHostedContext101Url } from "./hosted-url.js";
import { mask } from "./redact.js";
import { cdkOutputDir, isPublishedPackageStack } from "./stack-source.js";

export const CONTEXT_KEYS = [
  "DATABASE_URL",
  "DATABASE_DRIVER",
  "DATABASE_PREPARE",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "MCP_TOKEN_PEPPER",
  "APP_MODE",
  "ALLOW_PUBLIC_SIGNUP",
  "BILLING_ENABLED",
  "APP_URL",
  "MARKETING_URL",
  "MCP_PUBLIC_HOST",
  "MCP_DOMAIN_CERT_ARN",
  "MCP_APPRUNNER",
  "SES_REGION",
  "SES_FROM_EMAIL",
  "SES_REPLY_TO_EMAIL",
  "REPOSITORY",
  "EMBED_MODEL_ID",
  "CREATE_RDS",
  "STACK_NAME",
  "NAME_PREFIX",
];

const SECRET_CONTEXT = new Set([
  "token",
  "githubToken",
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "MCP_TOKEN_PEPPER",
]);

export function resolveDeployContext({
  repoRoot,
  env = {},
  home = false,
  envFile = null,
  cwd,
  exec,
} = {}) {
  const filePath = findDeployEnvPath({ repoRoot, envFile, home, cwd });
  const file = readDeployEnvFile(filePath);
  const values = { ...file.values };

  const token = String(env.CTX_TOKEN || values.CTX_TOKEN || "").trim();
  let githubToken = String(env.CTX_GH_TOKEN || values.CTX_GH_TOKEN || "").trim();
  if (!githubToken && exec) {
    const gh = exec({ command: "gh", args: ["auth", "token"], env });
    if (gh.ok) githubToken = String(gh.stdout || "").trim();
  }

  const awsProfile = env.AWS_PROFILE || values.AWS_PROFILE || "";
  const repository = String(values.REPOSITORY || env.REPOSITORY || "").trim();

  return {
    filePath: file.exists ? file.path : filePath,
    fileExists: file.exists,
    declared: file.declared,
    values,
    token,
    githubToken,
    awsProfile,
    repository,
  };
}

export function assertDeployTokens(context, { action = "deploy" } = {}) {
  if (action === "destroy") return;
  if (!context.token) {
    const error = new Error(
      "Missing CTX_TOKEN. Run `context101 init` or `context101 config set CTX_TOKEN=…`, then `context101 deploy`."
    );
    error.code = "USAGE";
    throw error;
  }
  if (context.repository) {
    const kind = classifyGithubToken(context.githubToken);
    if (!githubTokenWorksForAmplify(kind)) {
      const error = new Error(
        "GitHub token is not a personal access token (need ghp_ or github_pat_). Amplify CreateApp calls list-repository-webhooks; ghs_ / gho_ tokens 403 and roll the stack back. Set CTX_GH_TOKEN to a classic PAT with repo scope."
      );
      error.code = "USAGE";
      throw error;
    }
  }
}

export function buildCdkArgs({
  action = "deploy",
  seed = false,
  context,
  extraArgs = [],
  stackName = null,
  namePrefix = null,
  env = {},
  outputDir = null,
} = {}) {
  const args = [action];
  if (action === "destroy" && stackName) args.push(stackName);
  if (seed) args.push("-c", "seed=true");
  if (context.token) args.push("-c", `token=${context.token}`);
  if (context.repository && context.githubToken) {
    args.push("-c", `githubToken=${context.githubToken}`);
  }

  const identity = {
    STACK_NAME: stackName || "",
    NAME_PREFIX: namePrefix || "",
  };

  for (const key of CONTEXT_KEYS) {
    const forced = identity[key];
    if (forced) {
      args.push("-c", `${key}=${forced}`);
      continue;
    }
    if (context.fileExists && !context.declared.has(key)) continue;
    const value = context.fileExists
      ? context.values[key]
      : context.values[key] || env[key] || "";
    if (!value) continue;
    if (isHostedContext101Url(value)) {
      if (context.fileExists && context.declared.has(key)) {
        const error = new Error(
          `${key} in the env file is the hosted Context101 product, not a self-host URL. Omit it so CDK uses the Amplify default domain, or set a domain you own.`
        );
        error.code = "USAGE";
        throw error;
      }
      continue;
    }
    args.push("-c", `${key}=${value}`);
  }

  if (action === "deploy") args.push("--require-approval", "never");
  if (action === "destroy") args.push("--force");
  if (outputDir) args.push("--output", outputDir);
  args.push(...extraArgs);
  return args;
}

export function formatCdkPreview({ action, context, args, seed }) {
  const lines = [`cdk ${action}`];
  if (context.fileExists) {
    lines.push(`  env file:    ${displayEnv(context.filePath)}`);
  }
  if (context.awsProfile) lines.push(`  AWS_PROFILE: ${context.awsProfile}`);
  lines.push(`  token:       ${mask(context.token)}`);
  if (context.repository) {
    lines.push(`  githubToken: ${mask(context.githubToken)}`);
  } else {
    lines.push("  githubToken: (skipped — no REPOSITORY)");
  }
  for (const [flag, value] of contextPairs(args)) {
    if (flag === "token" || flag === "githubToken" || flag === "seed") continue;
    const shown = SECRET_CONTEXT.has(flag) ? `${flag}: ${mask(value)}` : `${flag}: ${value}`;
    lines.push(`  ${shown}`);
  }
  if (seed) lines.push("  seed:        true");
  return lines.join("\n");
}

function contextPairs(args) {
  const pairs = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "-c" && args[i + 1]) {
      const raw = args[i + 1];
      const eq = raw.indexOf("=");
      if (eq > 0) pairs.push([raw.slice(0, eq), raw.slice(eq + 1)]);
      i += 1;
    }
  }
  return pairs;
}

function displayEnv(filePath) {
  return displaySpaceEnv(filePath);
}

export function runCdk({
  repoRoot,
  stackRoot,
  action = "deploy",
  seed = false,
  extraArgs = [],
  stackName = null,
  namePrefix = null,
  env = {},
  home = false,
  envFile = null,
  cwd,
  exec,
  io,
  exists,
  spawn: spawnFn = spawn,
  stdio,
  verbose = false,
  progress,
  listenSignal,
  homeDir,
  version,
  packageDir: pkgDir,
} = {}) {
  const sourceRoot = stackRoot || repoRoot;
  if (isPublishedPackageStack(sourceRoot, pkgDir)) {
    io?.err?.("refusing to synth into the published CLI package.");
    return Promise.resolve(1);
  }
  const context = resolveDeployContext({
    repoRoot: sourceRoot,
    env,
    home,
    envFile,
    cwd,
    exec,
  });
  assertDeployTokens(context, { action });
  const resolvedHome = homeDir ?? homedir();
  const outputDir = cdkOutputDir(sourceRoot, { homeDir: resolvedHome, version });
  const resolvedStackName = stackName || context.values.STACK_NAME || "";
  const args = buildCdkArgs({
    action,
    seed,
    context,
    extraArgs,
    stackName: resolvedStackName || null,
    namePrefix: namePrefix || context.values.NAME_PREFIX || null,
    env,
    outputDir,
  });
  const execForDeps =
    exec && verbose
      ? (spec) => exec({ ...spec, stdio: "inherit" })
      : exec;
  const ready = ensureCheckoutDeps({
    repoRoot: sourceRoot,
    exec: execForDeps,
    io: verbose ? io : { dim() {}, err: io?.err },
    exists,
    packageDir: pkgDir,
  });
  if (!ready.ok) {
    io?.err?.(ready.error);
    return Promise.resolve(1);
  }
  const cdkBin = resolveCdkBin(sourceRoot, exists);
  if (!cdkBin) {
    io?.err?.("local cdk is missing. Reinstall context101-cli, then retry.");
    return Promise.resolve(1);
  }
  const childEnv = { ...env };
  if (context.awsProfile) childEnv.AWS_PROFILE = context.awsProfile;
  if (context.values.AWS_ACCESS_KEY_ID && !childEnv.AWS_ACCESS_KEY_ID) {
    childEnv.AWS_ACCESS_KEY_ID = context.values.AWS_ACCESS_KEY_ID;
  }
  if (context.values.AWS_SECRET_ACCESS_KEY && !childEnv.AWS_SECRET_ACCESS_KEY) {
    childEnv.AWS_SECRET_ACCESS_KEY = context.values.AWS_SECRET_ACCESS_KEY;
  }
  const inherit = verbose || stdio === "inherit";
  const childStdio = inherit
    ? "inherit"
    : stdio && stdio !== "pipe"
      ? stdio
      : ["ignore", "pipe", "pipe"];
  if (progress && !inherit) progress.start(actionLabel(action));

  return new Promise((resolve, reject) => {
    const child = spawnFn(cdkBin, args, {
      cwd: path.join(sourceRoot, "cdk"),
      env: childEnv,
      stdio: childStdio,
    });
    let output = "";
    let cancelled = false;
    if (!inherit) {
      child.stdout?.on?.("data", (chunk) => {
        output += String(chunk);
      });
      child.stderr?.on?.("data", (chunk) => {
        output += String(chunk);
      });
    }
    const onSigint = () => {
      cancelled = true;
      if (typeof child.kill === "function") child.kill("SIGINT");
    };
    const stopListen =
      typeof listenSignal === "function"
        ? listenSignal(onSigint)
        : attachSigint(onSigint);
    child.on("error", (error) => {
      progress?.stop();
      stopListen?.();
      reject(error);
    });
    child.on("exit", (code, signal) => {
      progress?.stop();
      stopListen?.();
      if (cancelled || signal === "SIGINT") {
        if (io) return resolve(printCancelled(io));
        return resolve(SIGINT_EXIT);
      }
      const status = code ?? 1;
      if (status !== 0 && !inherit && io?.err) {
        io.err(formatQuietFailure({ action, output, secrets: secretsFromContext(context) }));
      } else if (status === 0 && (action === "deploy" || action === "destroy") && typeof io?.ok === "function") {
        io.ok(formatQuietSuccess({ action, stackName: resolvedStackName }));
      }
      resolve(status);
    });
  });
}

function attachSigint(handler) {
  process.on("SIGINT", handler);
  return () => process.off("SIGINT", handler);
}
