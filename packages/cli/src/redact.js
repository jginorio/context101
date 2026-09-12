import { SECRET_KEYS } from "./defaults.js";

export function mask(value) {
  if (!value) return "(empty)";
  if (value.length <= 8) return "…";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function collectSecrets(values = {}) {
  const secrets = [];
  for (const key of SECRET_KEYS) {
    const value = values[key];
    if (typeof value === "string" && value.length > 0) secrets.push(value);
  }
  return secrets;
}

export function outputContainsSecret(text, secrets) {
  if (!text) return false;
  return secrets.some((secret) => secret && text.includes(secret));
}

export function assertNoSecrets(text, secrets, label = "output") {
  const hit = (secrets || []).find((secret) => secret && text.includes(secret));
  if (hit) {
    throw new Error(`${label} leaked a secret`);
  }
}
