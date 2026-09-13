import { existsSync } from "node:fs";
import path from "node:path";
import { isContext101Checkout } from "./repo.js";

export const CHECKOUT_HINT = "needs the CLI stack source (cdk/)";
export const INSTALLING_DEPS = "installing stack deps";
export const NPM_CI_TIMEOUT_MS = 600_000;

export function checkoutNeededMessage(prefix = "run this from a Context101 checkout") {
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
} = {}) {
  if (!repoRoot || !isContext101Checkout(repoRoot, exists)) {
    return { ok: false, installed: false, error: checkoutNeededMessage() };
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

  io?.dim?.(INSTALLING_DEPS);

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

  if (
    !hasCheckoutDeps(repoRoot, exists) &&
    exists(path.join(repoRoot, "cdk", "package-lock.json"))
  ) {
    const cdk = exec({
      command: "npm",
      args: ["ci"],
      cwd: path.join(repoRoot, "cdk"),
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
