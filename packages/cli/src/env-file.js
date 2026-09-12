import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  ALLOW_PUBLIC_SIGNUP,
  APP_MODE,
  BILLING_ENABLED,
  DRIVER_NEON,
  DRIVER_POSTGRES,
} from "./defaults.js";

export function inferDriver(url) {
  if (!url) return DRIVER_POSTGRES;
  return url.includes("neon.tech") ? DRIVER_NEON : DRIVER_POSTGRES;
}

export function inferPrepare(url) {
  if (!url) return true;
  return !/pooler\.supabase\.com/i.test(url);
}

export function quoteShell(value) {
  return `"${String(value).replace(/["\\$`]/g, "\\$&")}"`;
}

export function renderDeployEnv(values) {
  const lines = [
    "# Written by `npx context101 init`. Gitignored. chmod 600.",
    "# Deploy only via ./cdk/deploy.sh — never raw `cdk deploy`.",
    "",
    `CTX_TOKEN=${quoteShell(values.CTX_TOKEN)}`,
  ];

  if (values.CTX_GH_TOKEN) {
    lines.push(`CTX_GH_TOKEN=${quoteShell(values.CTX_GH_TOKEN)}`);
  } else {
    lines.push(
      "# CTX_GH_TOKEN omitted — ./cdk/deploy.sh will use `gh auth token` if logged in."
    );
  }

  lines.push("");
  if (values.AWS_PROFILE) {
    lines.push(`AWS_PROFILE=${quoteShell(values.AWS_PROFILE)}`);
  }
  if (values.AWS_REGION) {
    lines.push(`AWS_REGION=${quoteShell(values.AWS_REGION)}`);
  }

  lines.push("");
  lines.push(`DATABASE_URL=${quoteShell(values.DATABASE_URL)}`);
  lines.push(`DATABASE_DRIVER=${quoteShell(values.DATABASE_DRIVER)}`);
  lines.push(
    `DATABASE_PREPARE=${quoteShell(values.DATABASE_PREPARE ? "true" : "false")}`
  );

  lines.push("");
  lines.push(`BETTER_AUTH_SECRET=${quoteShell(values.BETTER_AUTH_SECRET)}`);
  lines.push(
    "# BETTER_AUTH_URL and APP_URL — set these after the first Amplify domain exists."
  );
  if (values.BETTER_AUTH_URL) {
    lines.push(`BETTER_AUTH_URL=${quoteShell(values.BETTER_AUTH_URL)}`);
  }
  if (values.APP_URL) {
    lines.push(`APP_URL=${quoteShell(values.APP_URL)}`);
  }
  lines.push(`MCP_TOKEN_PEPPER=${quoteShell(values.MCP_TOKEN_PEPPER)}`);

  lines.push("");
  lines.push(`APP_MODE=${quoteShell(values.APP_MODE ?? APP_MODE)}`);
  lines.push(
    `ALLOW_PUBLIC_SIGNUP=${quoteShell(values.ALLOW_PUBLIC_SIGNUP ?? ALLOW_PUBLIC_SIGNUP)}`
  );
  lines.push(
    `BILLING_ENABLED=${quoteShell(values.BILLING_ENABLED ?? BILLING_ENABLED)}`
  );

  if (values.REPOSITORY) {
    lines.push("");
    lines.push(`REPOSITORY=${quoteShell(values.REPOSITORY)}`);
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

export async function writeDeployEnv(filePath, values) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, renderDeployEnv(values), { encoding: "utf8", mode: 0o600 });
  await chmod(filePath, 0o600);
  return filePath;
}

export async function readExampleToken(examplePath) {
  try {
    const text = await readFile(examplePath, "utf8");
    const match = text.match(/^CTX_TOKEN=(.*)$/m);
    if (!match) return null;
    return unquote(match[1]);
  } catch {
    return null;
  }
}

function unquote(raw) {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
