const HOSTED_ZONE = "context101.dev";

/**
 * The hosted product lives on this zone. Self-host must use the operator's
 * domain or Amplify's default `main.<app-id>.amplifyapp.com`.
 */
export function isHostedContext101Url(raw) {
  if (raw == null) return false;
  const value = String(raw).trim();
  if (!value) return false;
  const host = hostnameOf(value);
  return host === HOSTED_ZONE || host.endsWith(`.${HOSTED_ZONE}`);
}

export function ownPublicUrl(raw) {
  if (raw == null) return undefined;
  const value = String(raw).trim();
  if (!value || isHostedContext101Url(value)) return undefined;
  return value;
}

function hostnameOf(value) {
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
      ? value
      : `https://${value}`;
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return value
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
      .split("/")[0]
      .split(":")[0]
      .toLowerCase();
  }
}
