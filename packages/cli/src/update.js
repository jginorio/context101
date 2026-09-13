import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createExec } from "./exec.js";
import { writers } from "./style.js";

export const NPM_PACKAGE = "context101-cli";
export const UPDATE_CHECK_TIMEOUT_MS = 2000;
export const UPDATE_INSTALL_TIMEOUT_MS = 120_000;
export const SKIP_UPDATE_ENV = "CONTEXT101_SKIP_UPDATE";
export const UPDATING_ENV = "CONTEXT101_UPDATING";

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function runningVersion({ packageVersion, packageJsonPath } = {}) {
  if (packageVersion) return String(packageVersion).trim();
  const filePath =
    packageJsonPath ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  try {
    const pkg = JSON.parse(readFileSync(filePath, "utf8"));
    return String(pkg.version || "").trim();
  } catch {
    return "";
  }
}

export function parseNpmVersion(raw) {
  const line = String(raw ?? "")
    .trim()
    .split(/\r?\n/)[0]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  if (!line || !VERSION_RE.test(line)) return null;
  return line;
}

export function compareSemver(a, b) {
  const left = parseNpmVersion(a);
  const right = parseNpmVersion(b);
  if (!left || !right) return 0;
  const pa = versionParts(left);
  const pb = versionParts(right);
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && !pb.pre) return -1;
  if (pa.pre === pb.pre) return 0;
  return pa.pre < pb.pre ? -1 : 1;
}

export function isNewerVersion(latest, current) {
  return compareSemver(latest, current) > 0;
}

export function updateNowMessage(version) {
  return `${version} is out. update now?`;
}

export function newerVersionNotice(version) {
  return `${version} is out`;
}

export function npmInstallSpec(version) {
  const pin = parseNpmVersion(version);
  if (!pin) return null;
  return `${NPM_PACKAGE}@${pin}`;
}

export function versionLine(ctx = {}) {
  return `${NPM_PACKAGE} ${runningVersion(ctx)}`;
}

export function shouldSkipUpdate(opts = {}, ctx = {}) {
  if (ctx.skipUpdate) return true;
  if (opts.command === "version") return true;
  const env = ctx.env ?? {};
  if (env[SKIP_UPDATE_ENV] || env[UPDATING_ENV]) return true;
  return false;
}

export async function maybeOfferUpdate(opts, ctx) {
  if (shouldSkipUpdate(opts, ctx)) return null;
  const io = writers(ctx);
  const current = runningVersion(ctx);
  if (!parseNpmVersion(current)) return null;

  let latest;
  try {
    latest = await resolveLatestVersion(ctx);
  } catch {
    return null;
  }
  if (!latest || !isNewerVersion(latest, current)) return null;

  const tty = Boolean(ctx.stdin && ctx.stdin.isTTY && ctx.stdout && ctx.stdout.isTTY);
  if (opts.yes || opts.dryRun || !tty) {
    io.dim(newerVersionNotice(latest));
    return null;
  }

  const accept = await askUpdate(ctx, latest);
  if (!accept) return null;

  const spec = npmInstallSpec(latest);
  if (!spec) return null;

  let installed = false;
  try {
    installed = await installPinnedVersion(ctx, spec);
  } catch {
    installed = false;
  }
  if (!installed) {
    io.err(`could not install ${spec}`);
    return null;
  }
  io.dim("re-run context101");
  return 0;
}

async function resolveLatestVersion(ctx) {
  if (typeof ctx.fetchNpmLatest === "function") {
    return parseNpmVersion(await ctx.fetchNpmLatest());
  }
  const exec = ctx.exec ?? createExec(ctx.env);
  const result = exec({
    command: "npm",
    args: ["view", NPM_PACKAGE, "version"],
    timeout: UPDATE_CHECK_TIMEOUT_MS,
    env: ctx.env,
  });
  if (!result?.ok) return null;
  return parseNpmVersion(result.stdout);
}

async function installPinnedVersion(ctx, spec) {
  if (typeof ctx.installCli === "function") {
    return Boolean(await ctx.installCli(spec));
  }
  const exec = ctx.exec ?? createExec(ctx.env);
  const result = exec({
    command: "npm",
    args: ["i", "-g", spec],
    timeout: UPDATE_INSTALL_TIMEOUT_MS,
    env: {
      ...(ctx.env ?? {}),
      [SKIP_UPDATE_ENV]: "1",
      [UPDATING_ENV]: "1",
    },
  });
  return Boolean(result?.ok);
}

async function askUpdate(ctx, version) {
  if (typeof ctx.confirmUpdate === "function") {
    return ctx.confirmUpdate(version);
  }
  const { confirm } = await import("@inquirer/prompts");
  return confirm({
    message: updateNowMessage(version),
    default: false,
  });
}

function versionParts(version) {
  const match = String(version).match(VERSION_RE);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] || "",
  };
}
