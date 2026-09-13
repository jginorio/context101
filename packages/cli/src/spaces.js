import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { readDeployEnvFile } from "./deploy-env-load.js";
import { HOME_ENV_REL, REPO_ENV_REL, STACK_NAME } from "./defaults.js";
import { findRepoRoot } from "./repo.js";

export const DEFAULT_SPACE = "default";
export const SPACES_REL = [".context101", "spaces"];
export const SPACE_ENV_NAME = "deploy-env";
export const SPACE_NAME_RE = /^[a-z][a-z0-9-]{0,23}$/;

export function spacesRoot(homeDir = homedir()) {
  return path.join(homeDir, ...SPACES_REL);
}

export function spaceDir(name, homeDir = homedir()) {
  return path.join(spacesRoot(homeDir), name);
}

export function defaultSpaceEnvPath(name, homeDir = homedir()) {
  return path.join(spaceDir(name, homeDir), SPACE_ENV_NAME);
}

export function parseSpaceName(raw, { required = true } = {}) {
  const name = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!name) {
    if (!required) return null;
    const err = new Error("space name required");
    err.code = "USAGE";
    throw err;
  }
  if (!SPACE_NAME_RE.test(name)) {
    const err = new Error(
      "space name must be lowercase letters, numbers, and hyphens (start with a letter)"
    );
    err.code = "USAGE";
    throw err;
  }
  return name;
}

export function stackNameForSpace(name) {
  if (name === DEFAULT_SPACE) return STACK_NAME;
  return `Context101${pascalSpace(name)}`;
}

export function namePrefixForSpace(name) {
  if (name === DEFAULT_SPACE) return "context101";
  return `context101-${name}`;
}

export function pascalSpace(name) {
  return String(name)
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function displaySpaceEnv(filePath, homeDir = homedir()) {
  if (!filePath) return "";
  const home = homeDir || homedir();
  if (filePath === home || filePath.startsWith(`${home}${path.sep}`)) {
    return `~${filePath.slice(home.length)}`;
  }
  if (
    filePath.endsWith(`${path.sep}cdk${path.sep}.deploy-env`) ||
    filePath.endsWith("cdk/.deploy-env")
  ) {
    return "cdk/.deploy-env";
  }
  return filePath;
}

export function listSpaceNames(homeDir = homedir(), exists = existsSync) {
  const root = spacesRoot(homeDir);
  if (!exists(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && SPACE_NAME_RE.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export function loadSpace(name, { homeDir = homedir(), exists = existsSync } = {}) {
  const parsed = parseSpaceName(name);
  const envPath = resolveRegisteredEnvPath(parsed, homeDir, exists);
  const file = readDeployEnvFile(envPath, { exists });
  const values = file.values;
  return {
    name: parsed,
    envPath,
    exists: file.exists,
    values,
    declared: file.declared,
    stackName: String(values.STACK_NAME || stackNameForSpace(parsed)).trim() || stackNameForSpace(parsed),
    namePrefix: String(values.NAME_PREFIX || namePrefixForSpace(parsed)).trim() || namePrefixForSpace(parsed),
    awsProfile: values.AWS_PROFILE || "",
    region: values.AWS_REGION || "",
  };
}

export function listSpaces({
  homeDir = homedir(),
  cwd,
  exists = existsSync,
} = {}) {
  const names = listSpaceNames(homeDir, exists);
  const spaces = names.map((name) => loadSpace(name, { homeDir, exists }));
  if (!names.includes(DEFAULT_SPACE)) {
    const legacy = discoverLegacyEnv({ homeDir, cwd, exists });
    if (legacy) spaces.push(spaceFromEnvFile(DEFAULT_SPACE, legacy, exists));
  }
  spaces.sort((a, b) => a.name.localeCompare(b.name));
  return spaces;
}

function spaceFromEnvFile(name, envPath, exists) {
  const file = readDeployEnvFile(envPath, { exists });
  const values = file.values;
  return {
    name,
    envPath,
    exists: file.exists,
    values,
    declared: file.declared,
    stackName:
      String(values.STACK_NAME || stackNameForSpace(name)).trim() ||
      stackNameForSpace(name),
    namePrefix:
      String(values.NAME_PREFIX || namePrefixForSpace(name)).trim() ||
      namePrefixForSpace(name),
    awsProfile: values.AWS_PROFILE || "",
    region: values.AWS_REGION || "",
  };
}

export function findSpaceByTarget(
  target,
  { homeDir = homedir(), cwd, exists = existsSync } = {}
) {
  const raw = String(target ?? "").trim();
  if (!raw) return null;
  const spaces = listSpaces({ homeDir, cwd, exists });
  const lower = raw.toLowerCase();
  return (
    spaces.find((space) => space.name === lower) ||
    spaces.find((space) => space.stackName === raw) ||
    null
  );
}

export function adoptLegacySpaces({
  homeDir = homedir(),
  cwd,
  exists = existsSync,
  copyFile = copyFileSync,
  mkdir = mkdirSync,
  writeFile = writeFileSync,
} = {}) {
  if (listSpaceNames(homeDir, exists).length) return listSpaces({ homeDir, exists });

  const legacy = discoverLegacyEnv({ homeDir, cwd, exists });
  if (!legacy) return [];

  const dest = defaultSpaceEnvPath(DEFAULT_SPACE, homeDir);
  if (!exists(dest)) {
    mkdir(path.dirname(dest), { recursive: true });
    copyFile(legacy, dest);
    const file = readDeployEnvFile(dest, { exists });
    const next = withSpaceIdentity(file.text, DEFAULT_SPACE, file.values);
    if (next !== file.text) writeFile(dest, next, { encoding: "utf8", mode: 0o600 });
  }
  return listSpaces({ homeDir, exists });
}

export function discoverLegacyEnv({ homeDir = homedir(), cwd, exists = existsSync } = {}) {
  const homeLegacy = path.join(homeDir, HOME_ENV_REL);
  if (exists(homeLegacy)) return homeLegacy;

  const starts = [];
  if (cwd) {
    starts.push(cwd);
    starts.push(path.join(cwd, "context101"));
    const repo = findRepoRoot(cwd, exists);
    if (repo) starts.push(repo);
  }
  for (const start of starts) {
    const candidate = path.join(start, ...REPO_ENV_REL.split("/"));
    if (exists(candidate)) return candidate;
  }
  return null;
}

export function withSpaceIdentity(text, name, values = {}) {
  let next = text || "";
  if (!/^SPACE=/m.test(next)) {
    next = appendEnvLine(next, "SPACE", name);
  }
  if (!values.STACK_NAME && !/^STACK_NAME=/m.test(next)) {
    next = appendEnvLine(next, "STACK_NAME", stackNameForSpace(name));
  }
  if (!values.NAME_PREFIX && !/^NAME_PREFIX=/m.test(next)) {
    next = appendEnvLine(next, "NAME_PREFIX", namePrefixForSpace(name));
  }
  return next.endsWith("\n") ? next : `${next}\n`;
}

function appendEnvLine(text, key, value) {
  const line = `${key}="${String(value).replace(/["\\$`]/g, "\\$&")}"`;
  const base = text || "";
  const trimmed = base.endsWith("\n") || !base ? base : `${base}\n`;
  return `${trimmed}${line}\n`;
}

function resolveRegisteredEnvPath(name, homeDir, exists) {
  const link = path.join(spaceDir(name, homeDir), "env-path");
  if (exists(link)) {
    try {
      const custom = readFileSync(link, "utf8").trim();
      if (custom) return custom;
    } catch {
      // fall through
    }
  }
  return defaultSpaceEnvPath(name, homeDir);
}

export function matchSpaces(opts = {}, ctx = {}) {
  const homeDir = ctx.homeDir ?? homedir();
  const spaces = listSpaces({ homeDir, cwd: ctx.cwd });
  const target = opts.space || opts.stackName;
  if (target) {
    const space = findSpaceByTarget(target, { homeDir, cwd: ctx.cwd });
    if (!space) {
      const err = new Error(`unknown space ${target}. Use \`context101 list\`.`);
      err.code = "USAGE";
      throw err;
    }
    return { spaces, space, needPick: false };
  }
  if (!spaces.length) {
    const err = new Error("no spaces yet. Run `context101 init`.");
    err.code = "USAGE";
    throw err;
  }
  if (spaces.length === 1) return { spaces, space: spaces[0], needPick: false };
  return { spaces, space: null, needPick: true };
}

export async function resolveSelectedSpace(opts, ctx) {
  const matched = matchSpaces(opts, ctx);
  if (matched.space) return matched.space;
  const tty = Boolean(ctx.stdin && ctx.stdin.isTTY && ctx.stdout && ctx.stdout.isTTY);
  if (!tty) {
    const names = matched.spaces.map((space) => space.name).join(", ");
    const err = new Error(`several spaces (${names}). Pass a name.`);
    err.code = "USAGE";
    throw err;
  }
  const pick = ctx.chooseSpace ?? chooseSpacePrompt;
  const name = await pick(matched.spaces);
  return matched.spaces.find((space) => space.name === name) || loadSpace(name, {
    homeDir: ctx.homeDir ?? homedir(),
  });
}

async function chooseSpacePrompt(spaces) {
  const { select } = await import("@inquirer/prompts");
  return select({
    message: "Space",
    choices: spaces.map((space) => ({
      name: `${space.name}  ${space.stackName}`,
      value: space.name,
    })),
  });
}

export function registerSpaceEnv(name, envPath, { homeDir = homedir() } = {}) {
  const dir = spaceDir(name, homeDir);
  mkdirSync(dir, { recursive: true });
  const canonical = defaultSpaceEnvPath(name, homeDir);
  if (path.resolve(envPath) !== path.resolve(canonical)) {
    writeFileSync(path.join(dir, "env-path"), `${path.resolve(envPath)}\n`, {
      encoding: "utf8",
    });
  }
  return envPath;
}
