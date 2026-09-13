import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runningVersion } from "./update.js";

export const STACK_CACHE_REL = [".cache", "context101"];
export const FETCHING_STACK = "fetching stack source";

export function isStackRoot(dir, exists = existsSync) {
  if (!dir) return false;
  return exists(path.join(dir, "cdk", "cdk.json"));
}

export function packageDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function embeddedStackRoot(exists = existsSync, pkgDir = packageDir()) {
  const packed = path.join(pkgDir, "stack");
  return isStackRoot(packed, exists) ? packed : null;
}

export function monorepoStackRoot(exists = existsSync, pkgDir = packageDir()) {
  let dir = pkgDir;
  for (let i = 0; i < 6; i += 1) {
    if (isStackRoot(dir, exists) && exists(path.join(dir, "packages", "cli", "package.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function cacheStackRoot(version, homeDir = homedir(), exists = existsSync) {
  const pin = String(version || "").trim();
  if (!pin) return null;
  const root = path.join(homeDir, ...STACK_CACHE_REL, pin);
  return isStackRoot(root, exists) ? root : null;
}

// Published CLI: explicit override, packaged stack/, version cache, then
// monorepo-dev. Never cwd, ~/context101, or cwd/context101.
export function resolveStackRoot({
  stackRoot,
  env = {},
  homeDir = homedir(),
  exists = existsSync,
  version,
  packageDir: pkgDir = packageDir(),
} = {}) {
  if (stackRoot && isStackRoot(stackRoot, exists)) return stackRoot;
  const fromEnv = String(env.CONTEXT101_STACK_ROOT || "").trim();
  if (fromEnv && isStackRoot(fromEnv, exists)) return fromEnv;
  const embedded = embeddedStackRoot(exists, pkgDir);
  if (embedded) return embedded;
  const cached = cacheStackRoot(version || runningVersion(), homeDir, exists);
  if (cached) return cached;
  const monorepo = monorepoStackRoot(exists, pkgDir);
  if (monorepo) return monorepo;
  return null;
}

export async function ensureStackRoot({
  stackRoot,
  env = {},
  homeDir = homedir(),
  exists = existsSync,
  mkdir = mkdirSync,
  fetchStack,
  version,
  packageDir: pkgDir = packageDir(),
  io,
} = {}) {
  const current = resolveStackRoot({
    stackRoot,
    env,
    homeDir,
    exists,
    version,
    packageDir: pkgDir,
  });
  if (current) return { ok: true, stackRoot: current, fetched: false };

  const pin = version || runningVersion();
  if (!pin || typeof fetchStack !== "function") {
    return {
      ok: false,
      stackRoot: null,
      fetched: false,
      error: "stack source is missing. Reinstall context101-cli, then retry.",
    };
  }

  io?.dim?.(FETCHING_STACK);
  const dest = path.join(homeDir, ...STACK_CACHE_REL, pin);
  mkdir(dest, { recursive: true });
  try {
    const fetched = await fetchStack({ version: pin, dest, env });
    const root = typeof fetched === "string" && fetched ? fetched : dest;
    if (isStackRoot(root, exists)) {
      return { ok: true, stackRoot: root, fetched: true };
    }
  } catch {
    // fall through
  }
  return {
    ok: false,
    stackRoot: null,
    fetched: false,
    error: "could not fetch stack source. Reinstall context101-cli, then retry.",
  };
}
