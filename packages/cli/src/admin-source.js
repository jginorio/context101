import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const ADMIN_SOURCE_RELS = [
  "amplify.yml",
  "package.json",
  "package-lock.json",
  "web",
  "site",
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

function git(exec, args, { cwd, env } = {}) {
  return exec({ command: "git", args, cwd, env });
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
      ["config", "credential.helper", helper],
      ["config", "credential.UseHttpPath", "true"],
      ["add", "-A"],
      ["commit", "-m", `context101-cli ${version || "admin"} admin`.trim()],
      ["remote", "add", "origin", url],
      ["push", "--force", "origin", "HEAD:main"],
    ];
    for (const args of steps) {
      const result = git(exec, args, { cwd: dest, env: gitEnv });
      if (!result?.ok) {
        io?.warn?.("admin source push failed — Amplify will build once web/ is on CodeCommit");
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
