import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  CreateSecretCommand,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { InvokeCommand } from "@aws-sdk/client-lambda";

import {
  CONNECTOR_SYNC_SHEETS_FN_NAME,
  CONNECTOR_TOKEN_SECRET_PREFIX,
  CONNECTORS_TABLE,
  ddbConnectors,
  GOOGLE_OAUTH_CLIENT_SECRET_ID,
  lambdaClient,
  sm,
  type Connector,
} from "@/utils/connectors";

/**
 * GET /api/connectors/oauth/callback?code=...&state=<connectorId>
 *
 * Exchanges the OAuth code for an {access_token, refresh_token}. Stores
 * the refresh_token in a new Secrets Manager secret. Flips the connector
 * row to `syncing` and fires the sync Lambda.
 */
export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const oauthError = request.nextUrl.searchParams.get("error");
  const origin = request.nextUrl.origin;
  const baseRedirect = new URL("/sources", origin);

  if (oauthError) {
    baseRedirect.searchParams.set("oauth_error", oauthError);
    return NextResponse.redirect(baseRedirect);
  }
  if (!state || !code) {
    baseRedirect.searchParams.set("oauth_error", "missing_state_or_code");
    return NextResponse.redirect(baseRedirect);
  }
  if (!CONNECTORS_TABLE || !GOOGLE_OAUTH_CLIENT_SECRET_ID) {
    baseRedirect.searchParams.set("oauth_error", "server_misconfigured");
    return NextResponse.redirect(baseRedirect);
  }

  try {
    // Confirm the connector row exists + is still pending
    const got = await ddbConnectors.send(
      new GetCommand({ TableName: CONNECTORS_TABLE, Key: { id: state } })
    );
    const row = got.Item as Connector | undefined;
    if (!row) throw new Error("connector row not found");
    if (row.type !== "sheets")
      throw new Error(`unexpected type: ${row.type}`);

    // Load OAuth client creds
    const client = await sm.send(
      new GetSecretValueCommand({ SecretId: GOOGLE_OAUTH_CLIENT_SECRET_ID })
    );
    const { client_id, client_secret } = JSON.parse(
      client.SecretString ?? "{}"
    );
    if (!client_id || !client_secret) throw new Error("OAuth client creds missing");

    // Exchange code for tokens. Must match the redirect_uri used at
    // /create (same request origin).
    const redirectUri = `${origin}/api/connectors/oauth/callback`;
    const exchange = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id,
        client_secret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!exchange.ok) {
      const text = await exchange.text().catch(() => "");
      throw new Error(`token exchange ${exchange.status}: ${text}`);
    }
    const tokens: {
      access_token?: string;
      refresh_token?: string;
      id_token?: string;
    } = await exchange.json();

    if (!tokens.refresh_token) {
      // If the user previously consented without revoking, Google may
      // not return a refresh_token. We ask for access_type=offline and
      // prompt=consent to avoid this, but surface it if it still happens.
      throw new Error(
        "Google didn't return a refresh_token — revoke the app at myaccount.google.com/permissions and reconnect"
      );
    }

    // Fetch Google profile (email, account)
    let googleEmail: string | undefined;
    if (tokens.access_token) {
      const u = await fetch(
        "https://openidconnect.googleapis.com/v1/userinfo",
        { headers: { Authorization: `Bearer ${tokens.access_token}` } }
      );
      if (u.ok) {
        const info = (await u.json()) as { email?: string };
        googleEmail = info.email;
      }
    }

    // Store refresh token in a new secret
    const tokenSecretName = `${CONNECTOR_TOKEN_SECRET_PREFIX}${row.id}`;
    const created = await sm.send(
      new CreateSecretCommand({
        Name: tokenSecretName,
        Description: `Refresh token for connector ${row.id} (${row.type})`,
        SecretString: JSON.stringify({ refresh_token: tokens.refresh_token }),
      })
    );

    // Flip the row to syncing + record token ARN + Google email
    await ddbConnectors.send(
      new UpdateCommand({
        TableName: CONNECTORS_TABLE,
        Key: { id: row.id },
        UpdateExpression:
          "SET #s = :s, token_secret_arn = :arn, google_account_email = :ge",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":s": "syncing",
          ":arn": created.ARN,
          ":ge": googleEmail ?? null,
        },
      })
    );

    // Fire the first sync (fire-and-forget)
    if (CONNECTOR_SYNC_SHEETS_FN_NAME) {
      await lambdaClient
        .send(
          new InvokeCommand({
            FunctionName: CONNECTOR_SYNC_SHEETS_FN_NAME,
            InvocationType: "Event",
            Payload: new TextEncoder().encode(
              JSON.stringify({ connectorId: row.id })
            ),
          })
        )
        .catch((e) => console.error("initial sync invoke failed:", e));
    }

    baseRedirect.searchParams.set("connected", row.id);
    return NextResponse.redirect(baseRedirect);
  } catch (err) {
    console.error("oauth callback failed:", err);
    const msg = err instanceof Error ? err.message : String(err);
    baseRedirect.searchParams.set(
      "oauth_error",
      msg.slice(0, 300)
    );
    return NextResponse.redirect(baseRedirect);
  }
}
