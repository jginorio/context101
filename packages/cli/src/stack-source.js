import { cpSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runningVersion } from "./update.js";

export const STACK_CACHE_REL = [".cache", "context101"];
export const FETCHING_STACK = "fetching stack source";
export const MATERIALIZING_STACK = "copying stack to writable cache";
export const NPM_PACKAGE_DIR = "context101-cli";

export const STACK_COPY_SKIP = new Set([
  "node_modules",
  "cdk.out",
  ".deploy-env",
  ".git",
  "dist",
  "coverage",
  ".next",
]);

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
  const dest = writableCacheDest(version, homeDir);
  if (!dest) return null;
  return isStackRoot(dest, exists) ? dest : null;
}

export function writableCacheDest(version, homeDir = homedir()) {
  const pin = String(version || "").trim();
  if (!pin) return null;
  return path.join(homeDir, ...STACK_CACHE_REL, pin);
}

export function isCacheStackRoot(dir, homeDir = homedir()) {
  if (!dir) return false;
  const cacheRoot = path.resolve(homeDir, ...STACK_CACHE_REL);
  const resolved = path.resolve(dir);
  return resolved === cacheRoot || resolved.startsWith(cacheRoot + path.sep);
}

export function isPublishedPackageStack(dir, pkgDir = packageDir()) {
  if (!dir) return false;
  const resolved = path.resolve(dir);
  const packed = path.resolve(pkgDir, "stack");
  if (resolved === packed || resolved.startsWith(packed + path.sep)) return true;
  const marker = `${path.sep}node_modules${path.sep}${NPM_PACKAGE_DIR}`;
  const index = resolved.indexOf(marker);
  if (index === -1) return false;
  const after = resolved.slice(index + marker.length);
  return after === "" || after.startsWith(path.sep);
}

export function allowStackCopy(src) {
  return !STACK_COPY_SKIP.has(path.basename(src));
}

export function materializePublishedStack(
  from,
  dest,
  { exists = existsSync, copy = cpSync, mkdir = mkdirSync } = {}
) {
  if (isStackRoot(dest, exists)) return dest;
  mkdir(dest, { recursive: true });
  copy(from, dest, { recursive: true, dereference: true, filter: allowStackCopy });
  return dest;
}

export function cdkOutputDir(stackRoot, { homeDir = homedir(), version } = {}) {
  if (!stackRoot) return null;
  if (isPublishedPackageStack(stackRoot)) {
    const dest = writableCacheDest(version || runningVersion(), homeDir);
    return dest ? `${dest}.cdk.out` : null;
  }
  if (isCacheStackRoot(stackRoot, homeDir)) {
    return `${path.resolve(stackRoot)}.cdk.out`;
  }
  return null;
}

// Read-only source: explicit override, CONTEXT101_STACK_ROOT, packaged
// stack/, version cache, then monorepo-dev. Never cwd, ~/context101, or
// cwd/context101.
export function resolveStackSource({
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

// Writable deploy root. Never the npm-global / packaged stack/ tree.
export function resolveStackRoot({
  stackRoot,
  env = {},
  homeDir = homedir(),
  exists = existsSync,
  version,
  packageDir: pkgDir = packageDir(),
} = {}) {
  if (stackRoot && isStackRoot(stackRoot, exists) && !isPublishedPackageStack(stackRoot, pkgDir)) {
    return stackRoot;
  }
  const fromEnv = String(env.CONTEXT101_STACK_ROOT || "").trim();
  if (fromEnv && isStackRoot(fromEnv, exists) && !isPublishedPackageStack(fromEnv, pkgDir)) {
    return fromEnv;
  }
  const cached = cacheStackRoot(version || runningVersion(), homeDir, exists);
  if (cached) return cached;
  const monorepo = monorepoStackRoot(exists, pkgDir);
  if (monorepo && !isPublishedPackageStack(monorepo, pkgDir)) return monorepo;
  return null;
}

export async function ensureStackRoot({
  stackRoot,
  env = {},
  homeDir = homedir(),
  exists = existsSync,
  mkdir = mkdirSync,
  copy = cpSync,
  fetchStack,
  version,
  packageDir: pkgDir = packageDir(),
  io,
} = {}) {
  const resolveOpts = {
    stackRoot,
    env,
    homeDir,
    exists,
    version,
    packageDir: pkgDir,
  };
  const current = resolveStackRoot(resolveOpts);
  if (current) return { ok: true, stackRoot: current, fetched: false };

  const pin = version || runningVersion();
  const source = resolveStackSource(resolveOpts);
  if (source && isPublishedPackageStack(source, pkgDir)) {
    const dest = writableCacheDest(pin, homeDir);
    if (dest) {
      io?.dim?.(MATERIALIZING_STACK);
      try {
        mkdir(dest, { recursive: true });
        materializePublishedStack(source, dest, { exists, copy, mkdir });
        if (isStackRoot(dest, exists)) {
          return { ok: true, stackRoot: dest, fetched: false, materialized: true };
        }
      } catch {
        // fall through
      }
    }
  }

  if (!pin || typeof fetchStack !== "function") {
    return {
      ok: false,
      stackRoot: null,
      fetched: false,
      error: "stack source is missing. Reinstall context101-cli, then retry.",
    };
  }

  io?.dim?.(FETCHING_STACK);
  const dest = writableCacheDest(pin, homeDir);
  if (!dest) {
    return {
      ok: false,
      stackRoot: null,
      fetched: false,
      error: "stack source is missing. Reinstall context101-cli, then retry.",
    };
  }
  mkdir(dest, { recursive: true });
  try {
    const fetched = await fetchStack({ version: pin, dest, env });
    const root = typeof fetched === "string" && fetched ? fetched : dest;
    if (isStackRoot(root, exists) && !isPublishedPackageStack(root, pkgDir)) {
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
