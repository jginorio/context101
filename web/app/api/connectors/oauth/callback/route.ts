import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  CreateSecretCommand,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { InvokeCommand } from "@aws-sdk/client-lambda";

import {
  CONNECTOR_TOKEN_SECRET_PREFIX,
  GOOGLE_OAUTH_CLIENT_SECRET_ID,
  isGoogleType,
  lambdaClient,
  NOTION_OAUTH_CLIENT_SECRET_ID,
  pgGetConnectorById,
  pgUpdateConnector,
  sm,
  syncFnNameFor,
  type ConnectorType,
} from "@/utils/connectors";
import { getBrainById } from "@/lib/brains-server";
import { bucketForBrain } from "@/utils/s3";
import { getPublicOrigin } from "@/utils/public-origin";

/**
 * GET /api/connectors/oauth/callback?code=...&state=<brainId>:<connectorId>
 *
 * Exchanges the OAuth code with the correct provider (Google or Notion),
 * stores the long-lived token (refresh_token for Google, access_token for
 * Notion) in a new Secrets Manager secret, flips the connector row to
 * `syncing`, and fires the first sync Lambda. The brain id comes from the
 * opaque OAuth `state` param so the callback can land back in the right
 * brain's connectors table without trusting cookies (the redirect
 * may come from an unauthenticated context — provider → callback).
 */
export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const oauthError = request.nextUrl.searchParams.get("error");
  // Use forwarded headers — request.nextUrl.origin is unreliable on
  // Amplify SSR (returns https://localhost:3000).
  const origin = getPublicOrigin(request);
  const baseRedirect = new URL("/sources", origin);

  if (oauthError) {
    baseRedirect.searchParams.set("oauth_error", oauthError);
    return NextResponse.redirect(baseRedirect);
  }
  if (!state || !code) {
    baseRedirect.searchParams.set("oauth_error", "missing_state_or_code");
    return NextResponse.redirect(baseRedirect);
  }

  // state = "<brain_id>:<connector_id>" (introduced in the multi-brain
  // refactor). Legacy state values without a colon are treated as
  // connector ids belonging to the default brain.
  const firstColon = state.indexOf(":");
  const brainId =
    firstColon >= 0 ? state.slice(0, firstColon) : "default";
  const connectorId = firstColon >= 0 ? state.slice(firstColon + 1) : state;

  const brain = await getBrainById(brainId);
  if (!brain || brain.status !== "ready") {
    baseRedirect.searchParams.set(
      "oauth_error",
      `brain ${brainId} not found or not ready`
    );
    return NextResponse.redirect(baseRedirect);
  }
  baseRedirect.searchParams.set("brain", brainId);
  const docsBucket = bucketForBrain(brain);

  try {
    // Confirm the connector row exists + is still pending
    const row = await pgGetConnectorById(connectorId);
    if (!row) throw new Error("connector row not found");
    const connectorType = row.type as ConnectorType;
    if (!["sheets", "docs", "slides", "notion"].includes(connectorType))
      throw new Error(`unexpected type: ${connectorType}`);

    const redirectUri = `${origin}/api/connectors/oauth/callback`;
    const isGoogle = isGoogleType(connectorType);

    // Load provider OAuth client creds
    const oauthClientSecretId = isGoogle
      ? GOOGLE_OAUTH_CLIENT_SECRET_ID
      : NOTION_OAUTH_CLIENT_SECRET_ID;
    if (!oauthClientSecretId)
      throw new Error(
        `${isGoogle ? "Google" : "Notion"} OAuth client secret id not configured`
      );

    const client = await sm.send(
      new GetSecretValueCommand({ SecretId: oauthClientSecretId })
    );
    const { client_id, client_secret } = JSON.parse(
      client.SecretString ?? "{}"
    );
    if (!client_id || !client_secret)
      throw new Error("OAuth client creds missing");

    // ── Branch: exchange code with the right provider ─────────────────
    let secretPayload: Record<string, unknown>;
    let googleEmail: string | undefined;
    let workspaceName: string | undefined;

    if (isGoogle) {
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
        throw new Error(`google token exchange ${exchange.status}: ${text}`);
      }
      const tokens: {
        access_token?: string;
        refresh_token?: string;
      } = await exchange.json();

      if (!tokens.refresh_token) {
        throw new Error(
          "Google didn't return a refresh_token — revoke the app at myaccount.google.com/permissions and reconnect"
        );
      }

      // Pull email via userinfo
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

      secretPayload = { refresh_token: tokens.refresh_token };
    } else {
      // Notion — POST /v1/oauth/token with HTTP Basic (client_id:client_secret)
      const basic = Buffer.from(`${client_id}:${client_secret}`).toString(
        "base64"
      );
      const exchange = await fetch("https://api.notion.com/v1/oauth/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!exchange.ok) {
        const text = await exchange.text().catch(() => "");
        throw new Error(`notion token exchange ${exchange.status}: ${text}`);
      }
      const tokens: {
        access_token?: string;
        workspace_id?: string;
        workspace_name?: string;
        workspace_icon?: string;
        bot_id?: string;
        owner?: unknown;
      } = await exchange.json();

      if (!tokens.access_token) throw new Error("Notion didn't return an access_token");

      workspaceName = tokens.workspace_name;
      secretPayload = {
        access_token: tokens.access_token,
        workspace_id: tokens.workspace_id,
        workspace_name: tokens.workspace_name,
        bot_id: tokens.bot_id,
      };
    }

    // Store the token(s) in a new per-connector secret
    const tokenSecretName = `${CONNECTOR_TOKEN_SECRET_PREFIX}${row.id}`;
    const created = await sm.send(
      new CreateSecretCommand({
        Name: tokenSecretName,
        Description: `OAuth token for connector ${row.id} (${connectorType})`,
        SecretString: JSON.stringify(secretPayload),
      })
    );

    // Flip the row to syncing + record token ARN + provider identity. The
    // provider identity (google email / notion workspace) lives in the
    // connector's metadata jsonb.
    const metadataPatch: Record<string, unknown> = {
      ...((row.metadata as Record<string, unknown>) ?? {}),
    };
    if (googleEmail) metadataPatch.google_account_email = googleEmail;
    if (workspaceName) metadataPatch.notion_workspace_name = workspaceName;
    await pgUpdateConnector(row.orgId, row.brainId, row.id, {
      status: "syncing",
      tokenSecretArn: created.ARN,
      metadata: metadataPatch,
    });

    // Fire the first sync (fire-and-forget). The payload carries the
    // brain's bucket so the sync Lambda routes into the right brain.
    const syncFn = syncFnNameFor(connectorType);
    if (syncFn) {
      await lambdaClient
        .send(
          new InvokeCommand({
            FunctionName: syncFn,
            InvocationType: "Event",
            Payload: new TextEncoder().encode(
              JSON.stringify({
                connectorId: row.id,
                docsBucket,
                brainId,
              })
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
    baseRedirect.searchParams.set("oauth_error", msg.slice(0, 300));
    return NextResponse.redirect(baseRedirect);
  }
}
