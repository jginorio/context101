export function parseStackOutputs(payload) {
  let rows = payload;
  if (typeof payload === "string") {
    const text = payload.trim();
    if (!text || text === "None" || text === "null") return {};
    try {
      rows = JSON.parse(text);
    } catch {
      return {};
    }
  }
  if (!Array.isArray(rows)) return {};
  const map = {};
  for (const row of rows) {
    const key = row?.OutputKey || row?.outputKey;
    if (!key) continue;
    map[key] = row.OutputValue ?? row.outputValue ?? "";
  }
  return map;
}

export function describeStackOutputs({
  exec,
  env = {},
  stackName,
  region,
} = {}) {
  const name = String(stackName || "").trim();
  if (!exec || !name) return {};
  const args = [
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    name,
    "--query",
    "Stacks[0].Outputs",
    "--output",
    "json",
  ];
  if (region) args.push("--region", region);
  const result = exec({ command: "aws", args, env });
  if (!result?.ok) return {};
  return parseStackOutputs(result.stdout);
}

export function asOutputMap(described = {}) {
  if (!described || typeof described !== "object") return {};
  if (Array.isArray(described)) return parseStackOutputs(described);
  if (Array.isArray(described.outputs)) return parseStackOutputs(described.outputs);
  return described;
}

export function pickAdminUrl(outputs = {}) {
  return String(asOutputMap(outputs).WebAppDefaultDomain || "").trim();
}

export function pickAdminRepoCloneUrl(outputs = {}) {
  return String(asOutputMap(outputs).AdminRepoCloneUrl || "").trim();
}

export function formatAdminUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  return `admin  ${value}`;
}
