import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const dest = path.resolve(here, "../stack");

const SKIP = new Set([
  "node_modules",
  "cdk.out",
  ".deploy-env",
  ".git",
  "dist",
  "coverage",
]);

function allow(src) {
  return !SKIP.has(path.basename(src));
}

function copyRel(rel) {
  const from = path.join(repoRoot, rel);
  if (!existsSync(from)) {
    throw new Error(`pack-stack: missing ${rel}`);
  }
  const to = path.join(dest, rel);
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true, filter: allow });
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

copyRel("cdk");
if (!existsSync(path.join(dest, "cdk", "package-lock.json"))) {
  throw new Error("pack-stack: cdk/package-lock.json is required for npm ci");
}
copyRel("wiki-generator-ts");
copyRel("knowledge");
copyRel("web/drizzle");
for (const file of ["Dockerfile", "requirements.txt", "server.py"]) {
  copyRel(file);
}
