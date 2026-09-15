import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SKIP = new Set([
  "node_modules",
  "cdk.out",
  ".deploy-env",
  ".git",
  "dist",
  "coverage",
  "stack",
  ".next",
]);

export function allow(src) {
  return !SKIP.has(path.basename(src));
}

function isInside(parent, child) {
  const root = path.resolve(parent);
  const target = path.resolve(child);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return target === root || target.startsWith(prefix);
}

/**
 * Copy repoRoot/rel → dest/rel.
 * When dest lives inside the source (the real layout: dest is
 * packages/cli/stack and rel is packages/cli), Node's cpSync throws
 * ERR_FS_CP_EINVAL before `filter` runs. Copy children instead and
 * never copy dest (`stack/`) into itself.
 */
export function copyRel(rel, repoRoot, dest) {
  const from = path.join(repoRoot, rel);
  if (!existsSync(from)) {
    throw new Error(`pack-stack: missing ${rel}`);
  }
  const to = path.join(dest, rel);
  mkdirSync(path.dirname(to), { recursive: true });
  if (isInside(from, dest)) {
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) {
      if (SKIP.has(name)) continue;
      const childFrom = path.join(from, name);
      if (isInside(childFrom, dest)) continue;
      cpSync(childFrom, path.join(to, name), { recursive: true, filter: allow });
    }
    return;
  }
  cpSync(from, to, { recursive: true, filter: allow });
}

export function packStack(repoRoot, dest) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });

  copyRel("cdk", repoRoot, dest);
  if (!existsSync(path.join(dest, "cdk", "package-lock.json"))) {
    throw new Error("pack-stack: cdk/package-lock.json is required for npm ci");
  }
  copyRel("wiki-generator-ts", repoRoot, dest);
  copyRel("knowledge", repoRoot, dest);
  copyRel("web", repoRoot, dest);
  copyRel("packages/design", repoRoot, dest);
  copyRel("packages/ui", repoRoot, dest);
  copyRel("packages/cli", repoRoot, dest);
  copyRel("scripts", repoRoot, dest);
  copyRel("amplify.yml", repoRoot, dest);
  copyRel("package.json", repoRoot, dest);
  copyRel("package-lock.json", repoRoot, dest);
  for (const file of ["Dockerfile", "requirements.txt", "server.py", "search_filter.py"]) {
    copyRel(file, repoRoot, dest);
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(here, "../../..");
const defaultDest = path.resolve(here, "../stack");

const invoked =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invoked) {
  packStack(defaultRoot, defaultDest);
}
