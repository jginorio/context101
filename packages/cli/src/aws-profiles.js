import { readFileSync } from "node:fs";
import path from "node:path";

export function listAwsProfiles({ exec, env = {}, readFile = readFileSync } = {}) {
  if (exec) {
    const cli = exec({
      command: "aws",
      args: ["configure", "list-profiles"],
      env,
    });
    if (cli.ok) return unique(splitLines(cli.stdout));
  }

  const home = env.HOME || env.USERPROFILE || "";
  const credPath =
    env.AWS_SHARED_CREDENTIALS_FILE ||
    (home ? path.join(home, ".aws", "credentials") : "");
  const configPath =
    env.AWS_CONFIG_FILE || (home ? path.join(home, ".aws", "config") : "");

  return unique([
    ...parseAwsCredentialsProfiles(readOptional(readFile, credPath)),
    ...parseAwsConfigProfiles(readOptional(readFile, configPath)),
  ]);
}

export function parseAwsCredentialsProfiles(text) {
  return sectionNames(text).filter((name) => !name.startsWith("sso-session"));
}

export function parseAwsConfigProfiles(text) {
  const names = [];
  for (const raw of sectionNames(text)) {
    if (raw.startsWith("sso-session")) continue;
    if (raw.startsWith("profile ")) names.push(raw.slice("profile ".length).trim());
    else names.push(raw);
  }
  return names.filter(Boolean);
}

export function resolveAwsProfile({ explicit, profiles, yes, dryRun }) {
  return resolveAwsAuth({
    explicitProfile: explicit,
    profiles,
    yes,
    dryRun,
  });
}

export function resolveAwsAuth({
  explicitProfile,
  accessKeyId,
  secretAccessKey,
  profiles,
  yes,
  dryRun,
}) {
  const list = Array.isArray(profiles) ? unique(profiles) : [];
  const keyId = accessKeyId || null;
  const secret = secretAccessKey || null;
  const empty = {
    profile: null,
    accessKeyId: null,
    secretAccessKey: null,
    profiles: list,
  };

  if (explicitProfile) {
    return { ...empty, profile: explicitProfile, source: "flag" };
  }
  if (list.length === 1) {
    return { ...empty, profile: list[0], source: "only" };
  }
  if (list.length > 1) {
    if (yes && !dryRun) {
      return {
        ...empty,
        source: "ask-profile",
        error: `multiple AWS profiles (${list.join(", ")}). Pass --aws-profile <name>.`,
      };
    }
    return { ...empty, source: "ask-profile" };
  }
  if (keyId && secret) {
    return { ...empty, accessKeyId: keyId, secretAccessKey: secret, source: "keys" };
  }
  if (keyId || secret) {
    return {
      ...empty,
      source: "ask-keys",
      error:
        "both --aws-access-key-id and --aws-secret-access-key (or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) are required.",
    };
  }
  if (yes && !dryRun) {
    return { ...empty, source: "default-chain" };
  }
  return { ...empty, source: "ask-keys" };
}

function sectionNames(text) {
  if (!text) return [];
  const names = [];
  for (const match of String(text).matchAll(/^\[([^\]]+)\]/gm)) {
    names.push(match[1].trim());
  }
  return names;
}

function splitLines(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function readOptional(readFile, filePath) {
  if (!filePath) return "";
  try {
    return readFile(filePath, "utf8");
  } catch {
    return "";
  }
}
