import { collectSecrets } from "./redact.js";

const NOISE = [
  /^\s*$/,
  /NOTICES?/i,
  /cdk notice/i,
  /npm notice/i,
  /Unable to find image/i,
  /Pulling from /i,
  /Already exists/i,
  /Download complete/i,
  /Downloading\s*\[/i,
  /Digest:/i,
  /Status: Downloaded newer image/i,
  /public\.ecr\.aws\/sam\/build-nodejs/i,
  /Bundling asset .+Stage\.\.\.\s*$/,
  /^[*\-=─]{8,}$/,
  /npm warn deprecated/i,
];

export const VERBOSE_HINT = "context101 deploy --verbose";

export function verboseHint(action = "deploy") {
  if (action === "destroy") return "context101 destroy --verbose";
  if (action === "diff") return "context101 diff --verbose";
  if (action === "synth") return "context101 synth --verbose";
  return VERBOSE_HINT;
}

export function lastUsefulError(text, { maxLines = 12 } = {}) {
  const lines = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\r/g, "").trimEnd())
    .filter((line) => line.trim() && !NOISE.some((re) => re.test(line)));
  if (!lines.length) return "";
  return lines.slice(-maxLines).join("\n");
}

export function secretsFromContext(context = {}) {
  return collectSecrets({
    CTX_TOKEN: context.token,
    CTX_GH_TOKEN: context.githubToken,
    ...(context.values || {}),
  });
}

export function redactSecrets(text, secrets = []) {
  let next = String(text ?? "");
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue;
    next = next.split(secret).join("…");
  }
  return next;
}

export function formatQuietFailure({ action = "deploy", output = "", secrets = [] } = {}) {
  const useful = redactSecrets(lastUsefulError(output), secrets);
  const hint = verboseHint(action);
  if (!useful) return hint;
  return `${useful}\n\n${hint}`;
}
