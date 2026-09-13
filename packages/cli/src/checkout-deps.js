import { existsSync } from "node:fs";
import path from "node:path";
import { isPublishedPackageStack, isStackRoot } from "./stack-source.js";

export const CHECKOUT_HINT = "needs the CLI stack source (cdk/)";
export const INSTALLING_DEPS = "installing stack deps";
export const NPM_CI_TIMEOUT_MS = 600_000;

export function checkoutNeededMessage(prefix = "could not use this stack source") {
  return `${prefix} (${CHECKOUT_HINT}).`;
}

export function hasCheckoutDeps(repoRoot, exists = existsSync) {
  return (
    exists(path.join(repoRoot, "node_modules", "aws-cdk-lib")) ||
    exists(path.join(repoRoot, "cdk", "node_modules", "aws-cdk-lib"))
  );
}

export function resolveCdkBin(repoRoot, exists = existsSync) {
  const candidates = [
    path.join(repoRoot, "node_modules", ".bin", "cdk"),
    path.join(repoRoot, "cdk", "node_modules", ".bin", "cdk"),
  ];
  return candidates.find((file) => exists(file)) || null;
}

export function ensureCheckoutDeps({
  repoRoot,
  exec,
  io,
  exists = existsSync,
  packageDir: pkgDir,
} = {}) {
  if (!repoRoot || !isStackRoot(repoRoot, exists)) {
    return { ok: false, installed: false, error: checkoutNeededMessage() };
  }
  if (isPublishedPackageStack(repoRoot, pkgDir)) {
    return {
      ok: false,
      installed: false,
      error: "refusing to install stack deps into the published CLI package.",
    };
  }
  if (hasCheckoutDeps(repoRoot, exists)) {
    return { ok: true, installed: false };
  }
  if (!exec) {
    return {
      ok: false,
      installed: false,
      error: "could not install stack deps (npm ci failed).",
    };
  }

  const rootLock = exists(path.join(repoRoot, "package-lock.json"));
  const cdkDir = path.join(repoRoot, "cdk");
  const cdkLock = exists(path.join(cdkDir, "package-lock.json"));
  if (!rootLock && !cdkLock) {
    return {
      ok: false,
      installed: false,
      error: "could not install stack deps (npm ci failed).",
    };
  }

  io?.dim?.(INSTALLING_DEPS);

  if (rootLock) {
    const root = exec({
      command: "npm",
      args: ["ci"],
      cwd: repoRoot,
      timeout: NPM_CI_TIMEOUT_MS,
    });
    if (!root.ok) {
      return {
        ok: false,
        installed: false,
        error: "could not install stack deps (npm ci failed).",
      };
    }
  }

  if (!hasCheckoutDeps(repoRoot, exists) && cdkLock) {
    const cdk = exec({
      command: "npm",
      args: ["ci"],
      cwd: cdkDir,
      timeout: NPM_CI_TIMEOUT_MS,
    });
    if (!cdk.ok) {
      return {
        ok: false,
        installed: false,
        error: "could not install stack deps (npm ci failed).",
      };
    }
  }

  return { ok: true, installed: true };
}
