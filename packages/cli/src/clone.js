import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DEFAULT_AMPLIFY_REPO } from "./defaults.js";
import { findRepoRoot } from "./repo.js";

export const CLONE_URL = DEFAULT_AMPLIFY_REPO;
export const DEFAULT_CLONE_DIR = "context101";

export function resolveCloneDir(cwd, dir) {
  return path.resolve(cwd, dir || DEFAULT_CLONE_DIR);
}

export function ensureRepoRoot({
  cwd,
  dir,
  exec,
  io,
  dryRun = false,
  exists = existsSync,
} = {}) {
  const existing = findRepoRoot(cwd, exists);
  if (existing) return { repoRoot: existing, cloned: false };

  const target = resolveCloneDir(cwd, dir);
  const already = findRepoRoot(target, exists);
  if (already) return { repoRoot: already, cloned: false };

  if (dryRun) {
    io?.write?.(`Would clone ${CLONE_URL} into ${path.relative(cwd, target) || target}`);
    return { repoRoot: target, cloned: false, wouldClone: true };
  }

  if (!exec) {
    return { repoRoot: null, cloned: false, error: "git is required to clone Context101" };
  }

  io?.write?.(`Cloning ${CLONE_URL}…`);
  if (!exists(path.dirname(target))) {
    mkdirSync(path.dirname(target), { recursive: true });
  }
  const result = exec({
    command: "git",
    args: ["clone", "--depth", "1", CLONE_URL, target],
    timeout: 120_000,
  });
  if (!result.ok) {
    return {
      repoRoot: null,
      cloned: false,
      error: result.stderr || result.stdout || "git clone failed",
    };
  }
  const cloned = findRepoRoot(target, exists);
  if (!cloned) {
    return {
      repoRoot: null,
      cloned: false,
      error: `cloned ${target} but it is not a Context101 checkout (needs cdk/ and web/)`,
    };
  }
  io?.ok?.(`cloned into ${path.relative(cwd, cloned) || cloned}`);
  return { repoRoot: cloned, cloned: true };
}
