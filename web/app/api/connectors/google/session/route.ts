import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { readAuthContext } from "@/lib/brains-server";
import {
  applyGoogleSessionCookie,
  exchangeGoogleAuthCode,
  getGoogleOAuthClient,
  googleUserEmail,
  readGoogleSession,
  refreshGoogleAccessToken,
} from "@/utils/google-oauth";

/**
 * GIS popup code clients exchange with redirect_uri=postmessage.
 * https://developers.google.com/identity/oauth2/web/guides/use-code-model
 */
const GIS_POPUP_REDIRECT = "postmessage";

/**
 * GET /api/connectors/google/session
 *
 * Mint a short-lived access token from the httpOnly picker-session
 * cookie (refresh_token). Used to open Google Picker without a second
 * consent when the user already connected Google.
 */
export async function GET(request: NextRequest) {
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const session = readGoogleSession(request);
  if (!session) {
    return NextResponse.json({ connected: false });
  }

  const client = await getGoogleOAuthClient();
  if (!client) {
    return NextResponse.json({
      connected: false,
      error: "GOOGLE_OAUTH_CLIENT_SECRET_ID not set — run cdk deploy",
    });
  }

  try {
    const tokens = await refreshGoogleAccessToken({
      refreshToken: session.refresh_token,
      clientId: client.client_id,
      clientSecret: client.client_secret,
    });
    return NextResponse.json({
      connected: true,
      accessToken: tokens.access_token,
      expiresIn: tokens.expires_in ?? 3600,
      email: session.email ?? null,
    });
  } catch (err) {
    console.error("google session refresh failed:", err);
    const response = NextResponse.json({
      connected: false,
      error:
        "Google access expired. Connect Google again to browse Drive.",
    });
    return applyGoogleSessionCookie(response, null);
  }
}

/**
 * POST /api/connectors/google/session
 * Body: { code: string }
 *
 * Exchange a GIS authorization code for tokens. Stores refresh_token
 * in an httpOnly cookie so later create can skip a second OAuth redirect.
 */
export async function POST(request: NextRequest) {
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!code) {
    return NextResponse.json({ error: "code required" }, { status: 400 });
  }

  const client = await getGoogleOAuthClient();
  if (!client) {
    return NextResponse.json(
      { error: "GOOGLE_OAUTH_CLIENT_SECRET_ID not set — run cdk deploy" },
      { status: 500 }
    );
  }

  try {
    const tokens = await exchangeGoogleAuthCode({
      code,
      clientId: client.client_id,
      clientSecret: client.client_secret,
      redirectUri: GIS_POPUP_REDIRECT,
    });
    if (!tokens.access_token) {
      throw new Error("Google didn't return an access_token");
    }
    const email =
      (await googleUserEmail(tokens.access_token)) ?? undefined;
    const response = NextResponse.json({
      connected: Boolean(tokens.refresh_token),
      accessToken: tokens.access_token,
      expiresIn: tokens.expires_in ?? 3600,
      email: email ?? null,
      hasRefreshToken: Boolean(tokens.refresh_token),
    });
    if (tokens.refresh_token) {
      applyGoogleSessionCookie(response, {
        refresh_token: tokens.refresh_token,
        email,
      });
    }
    return response;
  } catch (err) {
    console.error("google session exchange failed:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Google authorization could not be completed",
      },
      { status: 400 }
    );
  }
}

/** DELETE /api/connectors/google/session — forget the picker session. */
export async function DELETE(request: NextRequest) {
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const response = NextResponse.json({ connected: false });
  return applyGoogleSessionCookie(response, null);
}
