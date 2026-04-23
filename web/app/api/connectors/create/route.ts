import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

import {
  CONNECTORS_TABLE,
  ddbConnectors,
  GOOGLE_OAUTH_CLIENT_SECRET_ID,
  oauthScopesFor,
  parseGoogleResourceId,
  sm,
  type Connector,
  type ConnectorType,
} from "@/utils/connectors";
import { getCurrentUserEmail } from "@/utils/amplify-server-utils";
import { getPublicOrigin } from "@/utils/public-origin";

const SUPPORTED_TYPES: ConnectorType[] = ["sheets", "docs", "slides"];

function defaultLabelFor(type: ConnectorType): string {
  switch (type) {
    case "sheets":
      return "Untitled Sheets source";
    case "docs":
      return "Untitled Docs source";
    case "slides":
      return "Untitled Slides source";
    default:
      return "Untitled source";
  }
}

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
    !SUPPORTED_TYPES.includes(body.type) ||
    typeof body.label !== "string" ||
    typeof body.resource_url !== "string"
  ) {
    return NextResponse.json(
      {
        error: `type (one of ${SUPPORTED_TYPES.join("|")}), label, resource_url required`,
      },
      { status: 400 }
    );
  }
  const type = body.type as ConnectorType;

  const resourceId = parseGoogleResourceId(type, body.resource_url);
  if (!resourceId) {
    return NextResponse.json(
      {
        error: `Couldn't parse ${type} id from URL — expected a docs.google.com ${
          type === "sheets"
            ? "spreadsheet"
            : type === "docs"
              ? "document"
              : "presentation"
        } link`,
      },
      { status: 400 }
    );
  }

  const userEmail = await getCurrentUserEmail(request, response);
  const id = randomUUID();
  const now = new Date().toISOString();

  const row: Connector = {
    id,
    type,
    status: "pending_auth",
    label: body.label.trim().slice(0, 120) || defaultLabelFor(type),
    resource_url: body.resource_url.trim(),
    resource_id: resourceId,
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
    oauthUrl.searchParams.set("scope", oauthScopesFor(type).join(" "));
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
