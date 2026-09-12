import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DEFAULT_AMPLIFY_REPO, HOME_SRC_REL } from "./defaults.js";
import { findRepoRoot } from "./repo.js";

export const CLONE_URL = DEFAULT_AMPLIFY_REPO;
export const DEFAULT_CLONE_DIR = "context101";

export function resolveCloneDir(cwd, dir) {
  return path.resolve(cwd, dir || DEFAULT_CLONE_DIR);
}

export function homeSrcDir(homeDir = homedir()) {
  return path.join(homeDir, HOME_SRC_REL);
}

export function ensureRepoRoot({
  cwd,
  dir,
  exec,
  io,
  dryRun = false,
  exists = existsSync,
  homeDir,
  preferHomeClone = false,
} = {}) {
  const existing = findRepoRoot(cwd, exists);
  if (existing) return { repoRoot: existing, cloned: false };

  const localTarget = resolveCloneDir(cwd, dir);
  const alreadyLocal = findRepoRoot(localTarget, exists);
  if (alreadyLocal) return { repoRoot: alreadyLocal, cloned: false };

  const resolvedHome = homeDir ?? homedir();
  const homeTarget = homeSrcDir(resolvedHome);
  if (preferHomeClone) {
    const alreadyHome = findRepoRoot(homeTarget, exists);
    if (alreadyHome) return { repoRoot: alreadyHome, cloned: false };
  }

  const target = preferHomeClone && !dir ? homeTarget : localTarget;

  if (dryRun) {
    io?.write?.(`Would clone ${CLONE_URL} into ${displayCloneTarget(cwd, target, resolvedHome)}`);
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
  io?.ok?.(`cloned into ${displayCloneTarget(cwd, cloned, resolvedHome)}`);
  return { repoRoot: cloned, cloned: true };
}

function displayCloneTarget(cwd, target, homeDir) {
  if (homeDir && (target === homeDir || target.startsWith(homeDir + path.sep))) {
    return `~${target.slice(homeDir.length)}`;
  }
  return path.relative(cwd, target) || target;
}
