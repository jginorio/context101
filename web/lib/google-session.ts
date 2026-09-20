import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const GOOGLE_SESSION_COOKIE = "ctx_google_session";
export const GOOGLE_SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7;

export type GoogleSessionPayload = {
  refresh_token: string;
  email?: string;
};

function sessionKey(): Buffer {
  const secret =
    process.env.BETTER_AUTH_SECRET ??
    "development-only-better-auth-secret-change-me";
  return createHash("sha256").update(secret).digest();
}

/**
 * Encrypt a picker-session refresh token for an httpOnly cookie.
 * Format: base64url(iv).base64url(ciphertext+tag) using AES-256-GCM.
 */
export function encryptGoogleSession(payload: GoogleSessionPayload): string {
  const refresh = payload.refresh_token.trim();
  if (!refresh) throw new Error("google session missing refresh_token");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionKey(), iv);
  const plain = JSON.stringify({
    refresh_token: refresh,
    email:
      typeof payload.email === "string" && payload.email.trim()
        ? payload.email.trim()
        : undefined,
  } satisfies GoogleSessionPayload);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${Buffer.concat([encrypted, tag]).toString("base64url")}`;
}

export function decryptGoogleSession(
  value: string | null | undefined
): GoogleSessionPayload | null {
  if (!value) return null;
  const [ivPart, dataPart] = value.split(".");
  if (!ivPart || !dataPart) return null;
  try {
    const iv = Buffer.from(ivPart, "base64url");
    const packed = Buffer.from(dataPart, "base64url");
    if (iv.length !== 12 || packed.length <= 16) return null;
    const tag = packed.subarray(packed.length - 16);
    const encrypted = packed.subarray(0, packed.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", sessionKey(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(plain) as Partial<GoogleSessionPayload>;
    if (typeof parsed.refresh_token !== "string" || !parsed.refresh_token.trim()) {
      return null;
    }
    return {
      refresh_token: parsed.refresh_token.trim(),
      email:
        typeof parsed.email === "string" && parsed.email.trim()
          ? parsed.email.trim()
          : undefined,
    };
  } catch {
    return null;
  }
}
