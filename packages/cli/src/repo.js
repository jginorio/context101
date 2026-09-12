import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DEFAULT_AMPLIFY_REPO, HOME_ENV_REL, REPO_ENV_REL } from "./defaults.js";

export function findRepoRoot(startDir, exists = existsSync) {
  let dir = path.resolve(startDir);
  for (;;) {
    const deploy = path.join(dir, "cdk", "deploy.sh");
    const web = path.join(dir, "web", "package.json");
    if (exists(deploy) && exists(web)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function defaultEnvPath(repoRoot, { home = false } = {}) {
  if (home) return path.join(homedir(), HOME_ENV_REL);
  return path.join(repoRoot, ...REPO_ENV_REL.split("/"));
}

export function resolveEnvPath(repoRoot, opts) {
  if (opts.envFile) {
    return path.isAbsolute(opts.envFile)
      ? opts.envFile
      : path.resolve(opts.cwd ?? repoRoot, opts.envFile);
  }
  return defaultEnvPath(repoRoot, { home: opts.home });
}

export function normalizeRepoUrl(raw) {
  if (!raw) return "";
  let url = raw.trim();
  const ssh = url.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (ssh) return `https://github.com/${ssh[1]}`;
  url = url.replace(/\.git$/, "");
  return url;
}

export function detectGitRemote(exec, repoRoot) {
  const result = exec({
    command: "git",
    args: ["-C", repoRoot, "remote", "get-url", "origin"],
  });
  if (!result.ok) return "";
  return normalizeRepoUrl(result.stdout.split("\n")[0] || "");
}

export function readHardcodedRepo(stackSource) {
  const match = stackSource.match(/repository:\s*"(https:\/\/github\.com\/[^"]+)"/);
  return match ? match[1] : DEFAULT_AMPLIFY_REPO;
}

export function displayEnvPath(filePath, repoRoot) {
  if (filePath.startsWith(repoRoot + path.sep)) {
    return path.relative(repoRoot, filePath);
  }
  if (filePath.startsWith(homedir())) {
    return `~${filePath.slice(homedir().length)}`;
  }
  return filePath;
}
