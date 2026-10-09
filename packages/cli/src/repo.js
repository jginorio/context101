import { existsSync } from "node:fs";
import path from "node:path";
import { DEFAULT_AMPLIFY_REPO } from "./defaults.js";

export function isContext101Checkout(dir, exists = existsSync) {
  const web = exists(path.join(dir, "web", "package.json"));
  const cdk =
    exists(path.join(dir, "cdk", "cdk.json")) ||
    exists(path.join(dir, "cdk", "bin", "context101.ts")) ||
    exists(path.join(dir, "cdk", "deploy.sh"));
  const lockfile = exists(path.join(dir, "package-lock.json"));
  return web && cdk && lockfile;
}

export function findRepoRoot(startDir, exists = existsSync) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (isContext101Checkout(dir, exists)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function normalizeRepoUrl(raw) {
  if (!raw) return "";
  const trimmed = raw.trim();
  const ssh = trimmed.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (ssh) return `https://github.com/${ssh[1]}`;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      parsed.username = "";
      parsed.password = "";
      return parsed.toString().replace(/\.git\/?$/, "").replace(/\/$/, "");
    }
  } catch {
    // not a URL
  }
  return trimmed.replace(/\.git$/, "");
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
