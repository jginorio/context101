/**
 * Helpers for Better Auth's magic-link plugin. The plugin itself lives in
 * `server.ts`; this module stays importable from node:test without spinning
 * up Better Auth or Postgres.
 */

export function rewriteMagicLinkUrl(pluginUrl: string, appUrl: string): string {
  const generated = new URL(pluginUrl);
  const app = new URL(appUrl);
  generated.protocol = app.protocol;
  generated.host = app.host;
  return generated.toString();
}

/**
 * When public signup is off, only existing users get an email. The Better Auth
 * send endpoint still returns `{ status: true }` either way, so unknown
 * addresses cannot be enumerated.
 */
export function shouldSendMagicLink(input: {
  allowPublicSignup: boolean;
  userExists: boolean;
}): boolean {
  return input.allowPublicSignup || input.userExists;
}

export function extraTrustedOrigins(appUrl: string | undefined): string[] {
  if (!appUrl) return [];
  try {
    return [new URL(appUrl).origin];
  } catch {
    return [];
  }
}
