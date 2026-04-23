import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

import {
  CONNECTORS_TABLE,
  ddbConnectors,
  GOOGLE_OAUTH_CLIENT_SECRET_ID,
  parseSheetId,
  sm,
  type Connector,
} from "@/utils/connectors";
import { getCurrentUserEmail } from "@/utils/amplify-server-utils";
import { getPublicOrigin } from "@/utils/public-origin";

const SHEETS_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "openid",
  "email",
  "profile",
];

/**
 * POST /api/connectors/create
 * Body: { type: "sheets", label: string, resource_url: string }
 *
 * Creates a row in `pending_auth` and returns a Google OAuth URL.
 * The callback (/api/connectors/oauth/callback) completes the connection.
 */
export async function POST(request: NextRequest) {
  const response = NextResponse.next();

  if (!CONNECTORS_TABLE || !GOOGLE_OAUTH_CLIENT_SECRET_ID) {
    return NextResponse.json(
      { error: "required env vars not set — run cdk deploy" },
      { status: 500 }
    );
  }

  // The OAuth redirect URI must be whatever is registered in the GCP
  // OAuth client. On Amplify SSR, request.nextUrl.origin returns
  // "https://localhost:3000" because the Lambda runtime doesn't see
  // the public hostname. Read forwarded headers instead.
  const origin = getPublicOrigin(request);
  const redirectUri = `${origin}/api/connectors/oauth/callback`;

  const body = await request.json().catch(() => null);
  if (
    !body ||
    body.type !== "sheets" ||
    typeof body.label !== "string" ||
    typeof body.resource_url !== "string"
  ) {
    return NextResponse.json(
      { error: "type, label, resource_url required" },
      { status: 400 }
    );
  }

  const spreadsheetId = parseSheetId(body.resource_url);
  if (!spreadsheetId) {
    return NextResponse.json(
      { error: "Couldn't parse spreadsheet id from URL" },
      { status: 400 }
    );
  }

  const userEmail = await getCurrentUserEmail(request, response);
  const id = randomUUID();
  const now = new Date().toISOString();

  const row: Connector = {
    id,
    type: "sheets",
    status: "pending_auth",
    label: body.label.trim().slice(0, 120) || "Untitled Sheets source",
    resource_url: body.resource_url.trim(),
    resource_id: spreadsheetId,
    created_at: now,
    created_by: userEmail ?? undefined,
  };

  try {
    await ddbConnectors.send(
      new PutCommand({ TableName: CONNECTORS_TABLE, Item: row })
    );

    const client = await sm.send(
      new GetSecretValueCommand({ SecretId: GOOGLE_OAUTH_CLIENT_SECRET_ID })
    );
    const { client_id } = JSON.parse(client.SecretString ?? "{}");
    if (!client_id) throw new Error("OAuth client_id missing from secret");

    const oauthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    oauthUrl.searchParams.set("client_id", client_id);
    oauthUrl.searchParams.set("redirect_uri", redirectUri);
    oauthUrl.searchParams.set("response_type", "code");
    oauthUrl.searchParams.set("scope", SHEETS_SCOPES.join(" "));
    // access_type=offline + prompt=consent is how Google issues a
    // refresh_token on every consent (otherwise you only get one the
    // first time a user ever approves this client).
    oauthUrl.searchParams.set("access_type", "offline");
    oauthUrl.searchParams.set("prompt", "consent");
    oauthUrl.searchParams.set("include_granted_scopes", "true");
    oauthUrl.searchParams.set("state", id);

    return NextResponse.json({ id, oauthUrl: oauthUrl.toString() });
  } catch (err) {
    console.error("create connector failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
