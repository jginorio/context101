import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { existsSync } from "node:fs";
import { SECRET_KEYS } from "./defaults.js";
import { findDeployEnvPath, parseEnvFile } from "./deploy-env-load.js";
import { quoteShell } from "./env-file.js";
import { isHostedContext101Url } from "./hosted-url.js";
import { mask } from "./redact.js";
import { findRepoRoot } from "./repo.js";
import { banner, writers } from "./style.js";

const SECRET_NAME = /TOKEN|SECRET|PASSWORD|PEPPER|KEY/i;
const HOSTED_KEYS = new Set([
  "BETTER_AUTH_URL",
  "APP_URL",
  "MARKETING_URL",
  "MCP_PUBLIC_HOST",
]);

export function isSecretConfigKey(key) {
  return SECRET_KEYS.includes(key) || SECRET_NAME.test(key);
}

export function formatConfig(values) {
  const keys = Object.keys(values).sort();
  if (keys.length === 0) return "No keys in the env file.";
  return keys
    .map((key) => {
      const value = values[key] ?? "";
      const shown = isSecretConfigKey(key) ? mask(value) : value;
      return `${key}=${shown}`;
    })
    .join("\n");
}

export function upsertEnvLine(text, key, value) {
  const line = `${key}=${quoteShell(value)}`;
  const re = new RegExp(`^(\\s*(?:export\\s+)?${key}=).*`, "m");
  if (re.test(text || "")) return (text || "").replace(re, line);
  const base = !text ? "# Written by `context101 config set`. chmod 600.\n\n" : text;
  const trimmed = base.endsWith("\n") ? base : `${base}\n`;
  return `${trimmed}${line}\n`;
}

export async function runConfig(opts, ctx) {
  const io = writers(ctx);
  banner(ctx);

  const repoRoot = findRepoRoot(ctx.cwd);
  const filePath = findDeployEnvPath({
    repoRoot,
    envFile: opts.envFile,
    home: opts.home,
    cwd: ctx.cwd,
    homeDir: ctx.homeDir,
  });

  if (opts.configAction === "set") {
    return writeConfig(opts, { io, filePath });
  }

  if (!filePath || !existsSync(filePath)) {
    io.write("No deploy-env file yet.");
    io.write("Next: context101 init");
    return 0;
  }

  const text = await readFile(filePath, "utf8");
  const { values } = parseEnvFile(text);
  io.write(formatConfig(values));
  io.write("");
  return 0;
}

async function writeConfig(opts, { io, filePath }) {
  const key = opts.configKey;
  const value = opts.configValue;
  if (!key) {
    io.err("usage: context101 config set KEY=value");
    return 1;
  }
  if (HOSTED_KEYS.has(key) && isHostedContext101Url(value)) {
    io.err(
      `${key} is the hosted Context101 product, not a self-host URL. Set a domain you own, or omit it.`
    );
    return 1;
  }
  if (!filePath) {
    io.err("no deploy-env path. Pass --home or --deploy-env.");
    return 1;
  }

  let text = "";
  if (existsSync(filePath)) {
    text = await readFile(filePath, "utf8");
  }
  const next = upsertEnvLine(text, key, value);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, next, { encoding: "utf8", mode: 0o600 });
  await chmod(filePath, 0o600);
  io.ok(`set ${key}`);
  return 0;
}
