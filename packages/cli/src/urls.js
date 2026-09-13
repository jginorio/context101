import { homedir } from "node:os";
import { LIST_CLI, SMOOTH_REGION } from "./defaults.js";
import { resolveSelectedSpace } from "./spaces.js";
import { writers } from "./style.js";

const PUBLIC_KEYS = new Set(["WebAppDefaultDomain", "McpLambdaUrl", "McpUrl"]);

export function parseStackOutputs(payload) {
  if (Array.isArray(payload)) return payload.filter(Boolean);
  if (payload && Array.isArray(payload.Outputs)) return payload.Outputs.filter(Boolean);
  return [];
}

export function pickPublicUrls(outputs) {
  const map = {};
  for (const row of parseStackOutputs(outputs)) {
    const key = String(row.OutputKey || "").trim();
    if (!PUBLIC_KEYS.has(key)) continue;
    map[key] = String(row.OutputValue || "").trim();
  }
  return {
    admin: map.WebAppDefaultDomain || "",
    mcp: map.McpLambdaUrl || "",
    mcpLegacy: map.McpUrl || "",
  };
}

export function formatPublicUrls(picked = {}, { colors } = {}) {
  const c = colors ?? { dim: "", reset: "" };
  const rows = [["admin", picked.admin || "skipped"]];
  if (picked.mcp) {
    rows.push(["mcp", picked.mcp]);
    if (picked.mcpLegacy) rows.push(["mcp (legacy)", picked.mcpLegacy]);
  } else if (picked.mcpLegacy) {
    rows.push(["mcp (legacy)", picked.mcpLegacy]);
  }
  const labelW = Math.max(...rows.map(([label]) => label.length));
  return rows
    .map(([label, value]) => `  ${c.dim}${label.padEnd(labelW)}${c.reset}  ${value}`)
    .join("\n");
}

export function describeStackOutputs({
  exec,
  env,
  region = SMOOTH_REGION,
  stackName,
} = {}) {
  if (!exec) {
    return { ok: false, outputs: [], error: "aws cli not available" };
  }
  const name = String(stackName || "").trim();
  if (!name) {
    return { ok: false, outputs: [], error: "stack name required" };
  }
  const result = exec({
    command: "aws",
    args: [
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      name,
      "--region",
      region || SMOOTH_REGION,
      "--query",
      "Stacks[0].Outputs",
      "--output",
      "json",
    ],
    env,
  });
  if (!result.ok) {
    return {
      ok: false,
      outputs: [],
      error: result.stderr || result.stdout || "aws cloudformation describe-stacks failed",
    };
  }
  try {
    const outputs = parseStackOutputs(JSON.parse(result.stdout || "[]"));
    return { ok: true, outputs, error: null };
  } catch {
    return { ok: false, outputs: [], error: "could not parse cloudformation describe-stacks" };
  }
}

export function writePublicUrls(io, picked) {
  if (!io || typeof io.write !== "function") return;
  const text = formatPublicUrls(picked, { colors: io.c });
  if (text) io.write(text);
}

export function writeStackUrlsBestEffort({
  exec,
  env,
  region,
  stackName,
  io,
} = {}) {
  try {
    const described = describeStackOutputs({ exec, env, region, stackName });
    if (!described.ok) return false;
    writePublicUrls(io, pickPublicUrls(described.outputs));
    return true;
  } catch {
    return false;
  }
}

export async function runUrls(opts, ctx) {
  const io = writers(ctx);
  const exec = ctx.exec ?? (await import("./exec.js")).createExec(ctx.env);
  const homeDir = ctx.homeDir ?? homedir();

  let space;
  try {
    space = await resolveSelectedSpace(opts, { ...ctx, homeDir });
  } catch (error) {
    if (error && error.code === "USAGE") {
      io.err(error.message);
      return 1;
    }
    throw error;
  }

  const env = withAwsAuth(ctx.env ?? {}, {
    profile: opts.awsProfile || space.awsProfile,
    accessKeyId: opts.awsAccessKeyId || space.values?.AWS_ACCESS_KEY_ID,
    secretAccessKey: opts.awsSecretAccessKey || space.values?.AWS_SECRET_ACCESS_KEY,
  });
  const described = describeStackOutputs({
    exec,
    env,
    region: space.region || SMOOTH_REGION,
    stackName: space.stackName,
  });
  if (!described.ok) {
    if (isMissingStack(described.error)) {
      io.err(
        `unknown space ${opts.space || space.name}. Use a name from \`${LIST_CLI}\`.`
      );
    } else {
      io.err(described.error);
    }
    return 1;
  }
  writePublicUrls(io, pickPublicUrls(described.outputs));
  io.write("");
  return 0;
}

function isMissingStack(error) {
  return /does not exist|ValidationError/i.test(String(error || ""));
}

function withAwsAuth(env, { profile, accessKeyId, secretAccessKey } = {}) {
  const next = { ...env };
  if (profile) next.AWS_PROFILE = profile;
  if (accessKeyId) next.AWS_ACCESS_KEY_ID = accessKeyId;
  if (secretAccessKey) next.AWS_SECRET_ACCESS_KEY = secretAccessKey;
  return next;
}
