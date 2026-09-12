import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { HOME_ENV_REL, REPO_ENV_REL } from "./defaults.js";

export function unquoteEnvValue(raw) {
  const trimmed = String(raw ?? "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\([\\"$`])/g, "$1");
  }
  return trimmed;
}

export function parseEnvFile(text) {
  const values = {};
  const declared = new Set();
  const lines = String(text ?? "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    declared.add(match[1]);
    values[match[1]] = unquoteEnvValue(match[2]);
  }
  return { values, declared };
}

export function envFileDeclares(declared, key) {
  return Boolean(declared && declared.has(key));
}

export function findDeployEnvPath({
  repoRoot,
  envFile,
  home = false,
  cwd,
  exists = existsSync,
} = {}) {
  if (envFile) {
    return path.isAbsolute(envFile)
      ? envFile
      : path.resolve(cwd ?? repoRoot ?? process.cwd(), envFile);
  }
  if (home) {
    const homePath = path.join(homedir(), HOME_ENV_REL);
    return exists(homePath) ? homePath : homePath;
  }
  if (repoRoot) {
    const repoPath = path.join(repoRoot, ...REPO_ENV_REL.split("/"));
    if (exists(repoPath)) return repoPath;
  }
  const homePath = path.join(homedir(), HOME_ENV_REL);
  if (exists(homePath)) return homePath;
  return repoRoot ? path.join(repoRoot, ...REPO_ENV_REL.split("/")) : null;
}

export function readDeployEnvFile(filePath, { readFile = readFileSync, exists = existsSync } = {}) {
  if (!filePath || !exists(filePath)) {
    return { path: filePath, values: {}, declared: new Set(), text: "", exists: false };
  }
  const text = readFile(filePath, "utf8");
  const parsed = parseEnvFile(text);
  return {
    path: filePath,
    values: parsed.values,
    declared: parsed.declared,
    text,
    exists: true,
  };
}
