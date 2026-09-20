import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import type { NextRequest, NextResponse } from "next/server";

import {
  decryptGoogleSession,
  encryptGoogleSession,
  GOOGLE_SESSION_COOKIE,
  GOOGLE_SESSION_MAX_AGE_SEC,
  type GoogleSessionPayload,
} from "@/lib/google-session";
import { GOOGLE_OAUTH_CLIENT_SECRET_ID, sm } from "@/utils/connectors";

export type GoogleOAuthClient = {
  client_id: string;
  client_secret: string;
  picker_api_key?: string;
  picker_app_id?: string;
};

export function googlePickerApiKeyFromEnv(): string {
  return (
    process.env.GOOGLE_PICKER_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY?.trim() ||
    ""
  );
}

export function googlePickerAppIdFromEnv(): string {
  return (
    process.env.GOOGLE_PICKER_APP_ID?.trim() ||
    process.env.NEXT_PUBLIC_GOOGLE_PICKER_APP_ID?.trim() ||
    ""
  );
}

export async function getGoogleOAuthClient(): Promise<GoogleOAuthClient | null> {
  if (!GOOGLE_OAUTH_CLIENT_SECRET_ID) return null;
  try {
    const client = await sm.send(
      new GetSecretValueCommand({ SecretId: GOOGLE_OAUTH_CLIENT_SECRET_ID })
    );
    const parsed = JSON.parse(client.SecretString ?? "{}") as Partial<GoogleOAuthClient>;
    if (!parsed.client_id || !parsed.client_secret) return null;
    return {
      client_id: parsed.client_id,
      client_secret: parsed.client_secret,
      picker_api_key:
        typeof parsed.picker_api_key === "string"
          ? parsed.picker_api_key.trim() || undefined
          : undefined,
      picker_app_id:
        typeof parsed.picker_app_id === "string"
          ? parsed.picker_app_id.trim() || undefined
          : undefined,
    };
  } catch {
    return null;
  }
}

export function resolveGooglePickerKeys(client: GoogleOAuthClient | null): {
  apiKey: string;
  appId: string;
} {
  return {
    apiKey: client?.picker_api_key || googlePickerApiKeyFromEnv(),
    appId: client?.picker_app_id || googlePickerAppIdFromEnv(),
  };
}

export function readGoogleSession(
  request: NextRequest
): GoogleSessionPayload | null {
  return decryptGoogleSession(
    request.cookies.get(GOOGLE_SESSION_COOKIE)?.value
  );
}

export function applyGoogleSessionCookie(
  response: NextResponse,
  payload: GoogleSessionPayload | null
): NextResponse {
  if (!payload) {
    response.cookies.set(GOOGLE_SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/connectors",
      maxAge: 0,
    });
    return response;
  }
  response.cookies.set(GOOGLE_SESSION_COOKIE, encryptGoogleSession(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/connectors",
    maxAge: GOOGLE_SESSION_MAX_AGE_SEC,
  });
  return response;
}

export async function exchangeGoogleAuthCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}> {
  const exchange = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!exchange.ok) {
    const text = await exchange.text().catch(() => "");
    throw new Error(`google token exchange ${exchange.status}: ${text}`);
  }
  return (await exchange.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
}

export async function refreshGoogleAccessToken(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ access_token: string; expires_in?: number }> {
  const exchange = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!exchange.ok) {
    const text = await exchange.text().catch(() => "");
    throw new Error(`google refresh ${exchange.status}: ${text}`);
  }
  const tokens = (await exchange.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!tokens.access_token) throw new Error("Google didn't return an access_token");
  return { access_token: tokens.access_token, expires_in: tokens.expires_in };
}

export async function googleUserEmail(
  accessToken: string
): Promise<string | undefined> {
  const u = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!u.ok) return undefined;
  const info = (await u.json()) as { email?: string };
  return info.email;
}
