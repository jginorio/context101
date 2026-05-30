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
  oauthScopesFor,
  parseResourceId,
  pgInsertConnector,
  pgUpdateConnector,
  sm,
  syncFnNameFor,
  type ConnectorType,
} from "@/utils/connectors";
import { readAuthContext, resolveBrainFromRequest } from "@/lib/brains-server";
import { bucketForBrain } from "@/utils/s3";
import { getPublicOrigin } from "@/utils/public-origin";

const SUPPORTED_TYPES: ConnectorType[] = [
  "sheets",
  "docs",
  "slides",
  "notion",
  "github",
];

function defaultLabelFor(type: ConnectorType): string {
  switch (type) {
    case "sheets":
      return "Untitled Sheets source";
    case "docs":
      return "Untitled Docs source";
    case "slides":
      return "Untitled Slides source";
    case "notion":
      return "Untitled Notion source";
    case "github":
      return "Untitled GitHub repo";
    default:
      return "Untitled source";
  }
}

function resourceHint(type: ConnectorType): string {
  switch (type) {
    case "sheets":
      return "docs.google.com spreadsheet";
    case "docs":
      return "docs.google.com document";
    case "slides":
      return "docs.google.com presentation";
    case "notion":
      return "notion.so page or database";
    case "github":
      return "github.com/owner/repo";
    default:
      return "resource";
  }
}

/**
 * POST /api/connectors/create
 * Body: { type: ConnectorType, label: string, resource_url: string }
 *
 * Creates a row in `pending_auth` and returns the provider OAuth URL.
 * The callback (/api/connectors/oauth/callback) completes the connection.
 */
export async function POST(request: NextRequest) {
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const r = await resolveBrainFromRequest(request);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const brain = r.brain;
  const docsBucket = bucketForBrain(brain);

  // The OAuth redirect URI must be whatever is registered in the provider
  // console. On Amplify SSR, request.nextUrl.origin returns
  // "https://localhost:3000" because the Lambda runtime doesn't see the
  // public hostname — read forwarded headers instead.
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

  // Provider-specific env gating
  if (isGoogleType(type) && !GOOGLE_OAUTH_CLIENT_SECRET_ID) {
    return NextResponse.json(
      { error: "GOOGLE_OAUTH_CLIENT_SECRET_ID not set — run cdk deploy" },
      { status: 500 }
    );
  }
  if (type === "notion" && !NOTION_OAUTH_CLIENT_SECRET_ID) {
    return NextResponse.json(
      { error: "NOTION_OAUTH_CLIENT_SECRET_ID not set — run cdk deploy" },
      { status: 500 }
    );
  }

  // GitHub uses a Personal Access Token, not OAuth. We expect the token
  // in the body so we can short-circuit the OAuth dance.
  if (
    type === "github" &&
    (typeof body.github_pat !== "string" || !body.github_pat.trim())
  ) {
    return NextResponse.json(
      { error: "github_pat is required for type=github" },
      { status: 400 }
    );
  }

  const resourceId = parseResourceId(type, body.resource_url);
  if (!resourceId) {
    return NextResponse.json(
      { error: `Couldn't parse ${type} id from URL — expected a ${resourceHint(type)} link` },
      { status: 400 }
    );
  }

  const createdBy = auth.userEmail ?? auth.userId;

  try {
    const inserted = await pgInsertConnector({
      orgId: auth.orgId,
      brainId: brain.brain_id,
      type,
      label: body.label.trim().slice(0, 120) || defaultLabelFor(type),
      externalUrl: body.resource_url.trim(),
      externalId: resourceId,
      createdBy,
    });
    const id = inserted.id;

    // ── GitHub short-circuit (no OAuth dance) ─────────────────────────
    // PAT is the auth — store it in a per-connector secret, flip the row
    // to "syncing", fire the sync Lambda, and tell the client to redirect
    // straight to /sources?connected=<id>.
    if (type === "github") {
      const tokenSecretName = `${CONNECTOR_TOKEN_SECRET_PREFIX}${id}`;
      const created = await sm.send(
        new CreateSecretCommand({
          Name: tokenSecretName,
          Description: `GitHub PAT for connector ${id}`,
          SecretString: JSON.stringify({
            github_pat: (body.github_pat as string).trim(),
          }),
        })
      );
      await pgUpdateConnector(auth.orgId, brain.brain_id, id, {
        status: "syncing",
        tokenSecretArn: created.ARN,
      });
      const fn = syncFnNameFor("github");
      if (fn) {
        await lambdaClient
          .send(
            new InvokeCommand({
              FunctionName: fn,
              InvocationType: "Event",
              Payload: new TextEncoder().encode(
                JSON.stringify({
                  connectorId: id,
                  docsBucket,
                  brainId: brain.brain_id,
                })
              ),
            })
          )
          .catch((e) => console.error("initial sync invoke failed:", e));
      }
      // Reuse the existing dialog flow: it does
      //   window.location.href = j.oauthUrl
      // so we hand back a relative URL that simply navigates back to /sources.
      // Preserve the brain query param so the redirect lands on the right
      // brain's sources view.
      return NextResponse.json({
        id,
        oauthUrl: `/sources?brain=${encodeURIComponent(brain.brain_id)}&connected=${id}`,
      });
    }

    // Build the provider-specific authorize URL
    const oauthClientSecretId = isGoogleType(type)
      ? GOOGLE_OAUTH_CLIENT_SECRET_ID
      : NOTION_OAUTH_CLIENT_SECRET_ID;
    const client = await sm.send(
      new GetSecretValueCommand({ SecretId: oauthClientSecretId })
    );
    const { client_id } = JSON.parse(client.SecretString ?? "{}");
    if (!client_id) throw new Error("OAuth client_id missing from secret");

    let oauthUrl: URL;
    if (isGoogleType(type)) {
      oauthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      oauthUrl.searchParams.set("client_id", client_id);
      oauthUrl.searchParams.set("redirect_uri", redirectUri);
      oauthUrl.searchParams.set("response_type", "code");
      oauthUrl.searchParams.set("scope", oauthScopesFor(type).join(" "));
      // access_type=offline + prompt=consent gets a refresh_token every time
      oauthUrl.searchParams.set("access_type", "offline");
      oauthUrl.searchParams.set("prompt", "consent");
      oauthUrl.searchParams.set("include_granted_scopes", "true");
      // state = <brain_id>:<connector_id> — the OAuth callback splits on
      // the first colon to route into the right brain's table.
      oauthUrl.searchParams.set("state", `${brain.brain_id}:${id}`);
    } else {
      // Notion — public integration OAuth
      oauthUrl = new URL("https://api.notion.com/v1/oauth/authorize");
      oauthUrl.searchParams.set("client_id", client_id);
      oauthUrl.searchParams.set("redirect_uri", redirectUri);
      oauthUrl.searchParams.set("response_type", "code");
      // "user" lets the user pick which pages/databases to grant access to
      oauthUrl.searchParams.set("owner", "user");
      // state = <brain_id>:<connector_id> — the OAuth callback splits on
      // the first colon to route into the right brain's table.
      oauthUrl.searchParams.set("state", `${brain.brain_id}:${id}`);
    }

    return NextResponse.json({ id, oauthUrl: oauthUrl.toString() });
  } catch (err) {
    console.error("create connector failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
