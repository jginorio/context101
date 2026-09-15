import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectSecrets } from "./redact.js";

export const ADMIN_GIT_TIMEOUT_MS = 300_000;
const ADMIN_GIT_HEAVY = new Set(["add", "commit", "push"]);
const GIT_DETAIL_MAX = 240;

export const ADMIN_SOURCE_RELS = [
  "amplify.yml",
  "package.json",
  "package-lock.json",
  "web",
  "packages/design",
  "packages/ui",
  "packages/cli",
  "scripts",
];

export const ADMIN_COPY_SKIP = new Set([
  "node_modules",
  ".next",
  "cdk.out",
  ".deploy-env",
  ".git",
  "dist",
  "coverage",
]);

export function allowAdminCopy(src) {
  return !ADMIN_COPY_SKIP.has(path.basename(src));
}

export function hasAdminSource(stackRoot, exists = existsSync) {
  if (!stackRoot) return false;
  return (
    exists(path.join(stackRoot, "web", "package.json")) &&
    exists(path.join(stackRoot, "amplify.yml"))
  );
}

export function stageAdminSource(
  stackRoot,
  dest,
  { exists = existsSync, copy = cpSync } = {}
) {
  for (const rel of ADMIN_SOURCE_RELS) {
    const from = path.join(stackRoot, rel);
    if (!exists(from)) continue;
    copy(from, path.join(dest, rel), { recursive: true, filter: allowAdminCopy });
  }
  return dest;
}

function git(exec, args, { cwd, env, timeout } = {}) {
  const spec = { command: "git", args, cwd, env };
  if (timeout != null) spec.timeout = timeout;
  return exec(spec);
}

export function sanitizeAdminGitDetail(text, env = {}) {
  let next = String(text ?? "");
  for (const secret of collectSecrets(env)) {
    if (!secret || secret.length < 4) continue;
    next = next.split(secret).join("…");
  }
  next = next
    .replace(/^password\s*[:=]\s*.+$/gim, "password=…")
    .replace(/^(authorization|token|bearer)\s*[:=]\s*.+$/gim, "$1=…")
    .replace(/https?:\/\/[^/\s]*:[^/\s@]+@/gi, "https://…@");
  const lines = next
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  next = lines.slice(-3).join(" ");
  if (next.length > GIT_DETAIL_MAX) next = `${next.slice(0, GIT_DETAIL_MAX)}…`;
  return next;
}

function formatPushFailure(step, result, env) {
  const timedOut =
    result?.error?.code === "ETIMEDOUT" ||
    /ETIMEDOUT/i.test(String(result?.error?.message || ""));
  const raw = [result?.stderr, result?.stdout, result?.error?.message]
    .filter(Boolean)
    .join("\n");
  const detail = sanitizeAdminGitDetail(raw, env);
  const extra = timedOut ? " (timed out)" : detail ? `: ${detail}` : "";
  return `admin source push failed at git ${step}${extra} — Amplify will build once web/ is on CodeCommit`;
}

export function pushAdminSource({
  stackRoot,
  cloneUrl,
  exec,
  env = {},
  io,
  region,
  version = "",
  exists = existsSync,
  copy = cpSync,
  mkdtemp = mkdtempSync,
  rm = rmSync,
} = {}) {
  const url = String(cloneUrl || "").trim();
  if (!url) return { ok: true, skipped: "no-clone-url" };
  if (!exec) return { ok: false, error: "no exec" };
  if (!hasAdminSource(stackRoot, exists)) {
    io?.warn?.("admin source missing web/ — skip CodeCommit push");
    return { ok: true, skipped: "no-web" };
  }

  const dest = mkdtemp(path.join(tmpdir(), "ctx101-admin-"));
  try {
    stageAdminSource(stackRoot, dest, { exists, copy });
    const gitEnv = { ...env };
    if (region && !gitEnv.AWS_REGION) gitEnv.AWS_REGION = region;
    const helper = region
      ? `!aws --region ${region} codecommit credential-helper $@`
      : "!aws codecommit credential-helper $@";
    const steps = [
      ["init", "-b", "main"],
      ["config", "user.email", "context101-cli@local"],
      ["config", "user.name", "context101-cli"],
      // Empty helper resets the inherited list (osxkeychain). Replacing
      // without --add drops that reset and global helpers apply again.
      ["config", "--local", "credential.helper", ""],
      ["config", "--local", "--add", "credential.helper", helper],
      ["config", "--local", "credential.UseHttpPath", "true"],
      ["add", "-A"],
      ["commit", "-m", `context101-cli ${version || "admin"} admin`.trim()],
      ["remote", "add", "origin", url],
      ["push", "--force", "origin", "HEAD:main"],
    ];
    for (const args of steps) {
      const timeout = ADMIN_GIT_HEAVY.has(args[0]) ? ADMIN_GIT_TIMEOUT_MS : undefined;
      const result = git(exec, args, { cwd: dest, env: gitEnv, timeout });
      if (!result?.ok) {
        io?.warn?.(formatPushFailure(args[0], result, gitEnv));
        return { ok: false, error: "git-failed", step: args[0] };
      }
    }
    return { ok: true, pushed: true };
  } finally {
    try {
      rm(dest, { recursive: true, force: true });
    } catch {
      // temp dir cleanup is best-effort
    }
  }
}
