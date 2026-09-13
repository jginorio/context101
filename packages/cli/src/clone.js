import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DEFAULT_AMPLIFY_REPO, HOME_SRC_REL } from "./defaults.js";
import { findRepoRoot } from "./repo.js";

export const CLONE_URL = DEFAULT_AMPLIFY_REPO;
export const DEFAULT_CLONE_DIR = "context101";
export const UPDATING_CHECKOUT = "updating checkout";
export const GIT_PULL_TIMEOUT_MS = 120_000;

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
      error: `cloned ${target} but it is not a Context101 checkout (needs cdk/, web/, and a root lockfile)`,
    };
  }
  io?.ok?.(`cloned into ${displayCloneTarget(cwd, cloned, resolvedHome)}`);
  return { repoRoot: cloned, cloned: true };
}

export function pullCheckout({ repoRoot, exec, io } = {}) {
  if (!repoRoot || !exec) {
    return { ok: false, error: "could not update checkout (git pull --ff-only failed)." };
  }
  io?.dim?.(UPDATING_CHECKOUT);
  const result = exec({
    command: "git",
    args: ["pull", "--ff-only"],
    cwd: repoRoot,
    timeout: GIT_PULL_TIMEOUT_MS,
  });
  if (!result.ok) {
    return { ok: false, error: "could not update checkout (git pull --ff-only failed)." };
  }
  return { ok: true };
}

function displayCloneTarget(cwd, target, homeDir) {
  if (homeDir && (target === homeDir || target.startsWith(homeDir + path.sep))) {
    return `~${target.slice(homeDir.length)}`;
  }
  return path.relative(cwd, target) || target;
}
