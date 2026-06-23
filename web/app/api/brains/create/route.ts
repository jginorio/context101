import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { publicBrain, readAuthContext } from "@/lib/brains-server";
import { db } from "@/lib/db/client";
import { brains as brainsTable } from "@/lib/db/schema";
import {
  DEFAULT_EMBEDDING_DIMENSION,
  DEFAULT_EMBEDDING_MODEL_ID,
  resolveEmbeddingSelection,
} from "@/lib/embedding-models";

const AWS_REGION = process.env.AWS_REGION ?? "us-east-1";
const PROVISIONER_FN_NAME = process.env.BRAIN_PROVISIONER_FN_NAME ?? "";
const lambdaClient = new LambdaClient({
  region: AWS_REGION,
});

// Slug rules — must match the regex enforced by the provisioner Lambda:
// /^[a-z0-9][a-z0-9-]{0,62}$/. Includes a short random suffix so two
// brains with the same display name don't collide.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function nanoid(len = 5): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz0123456789"; // no l/o/0/1 confusables
  let s = "";
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) s += alphabet[buf[i] % alphabet.length];
  return s;
}

/**
 * POST /api/brains/create
 * Body: { display_name: string, description?: string }
 *
 * Generates a brain_id from the display name + a short random suffix and
 * invokes the BrainProvisionerFn synchronously to provision the per-brain
 * S3 bucket, KB, vector index, DDB tables, and bearer-token secret.
 *
 * Returns the registry row with status="ready" once provisioning succeeds,
 * or status="error" with error_msg if any step failed. The provisioner is
 * idempotent — failed creates can be retried by re-POSTing with the same
 * brain_id (we'd need a separate retry endpoint; v1 just supports first
 * attempts).
 */
export async function POST(request: NextRequest) {
  if (!PROVISIONER_FN_NAME) {
    return NextResponse.json(
      { error: "BRAIN_PROVISIONER_FN_NAME env var is not set" },
      { status: 500 }
    );
  }

  // The provisioner writes the brain row to the Postgres control plane,
  // which requires an owning org + creator. Both come from the Better Auth
  // session.
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const displayName =
    body && typeof body.display_name === "string"
      ? body.display_name.trim()
      : "";
  const description =
    body && typeof body.description === "string"
      ? body.description.trim()
      : undefined;

  if (!displayName) {
    return NextResponse.json(
      { error: "display_name is required" },
      { status: 400 }
    );
  }
  if (displayName.length > 80) {
    return NextResponse.json(
      { error: "display_name too long (max 80 chars)" },
      { status: 400 }
    );
  }

  const slug = slugify(displayName);
  if (!slug) {
    return NextResponse.json(
      { error: "display_name must contain at least one alphanumeric character" },
      { status: 400 }
    );
  }
  const brainId = `${slug}-${nanoid()}`;

  // Embedding selection is optional — when omitted the brain is provisioned
  // with the default AWS Titan v2 @ 1024 + Bedrock-managed chunking, matching
  // the deploy-time default. When provided, validate it against the catalog.
  const hasEmbeddingChoice =
    body &&
    (body.embedding_provider != null || body.embedding_model_id != null);
  const embedding = hasEmbeddingChoice
    ? resolveEmbeddingSelection(
        {
          provider: body.embedding_provider,
          modelId: body.embedding_model_id,
          dimensions: body.embedding_dimensions,
          chunkingConfig: body.chunking_config,
        },
        AWS_REGION
      )
    : ({
        ok: true,
        selection: {
          provider: "aws" as const,
          modelId: DEFAULT_EMBEDDING_MODEL_ID,
          modelArn: undefined,
          dimensions: DEFAULT_EMBEDDING_DIMENSION,
          chunking: { strategy: "default" as const },
        },
      } as const);
  if (!embedding.ok) {
    return NextResponse.json({ error: embedding.error }, { status: 400 });
  }
  const sel = embedding.selection;

  const createdByEmail = auth.userEmail;

  try {
    // Pre-insert the provisioning row so the UI can poll it immediately.
    // Without this, the client polls /api/brains/<id> before the async
    // provisioner has inserted anything (→ 404), and the brains list never
    // shows the new card until a manual refresh. The provisioner treats an
    // existing `provisioning` row as a resume, so this is race-safe.
    if (db) {
      await db
        .insert(brainsTable)
        .values({
          id: brainId,
          orgId: auth.orgId,
          displayName,
          description: description ?? null,
          status: "provisioning",
          embeddingModelProvider: sel.provider,
          embeddingModelId: sel.modelId,
          embeddingModelArn: sel.modelArn ?? null,
          embeddingDimensions: sel.dimensions,
          embeddingChunking: sel.chunking,
          createdBy: auth.userId,
        })
        .onConflictDoNothing();
    }

    // Fire-and-forget. The provisioner's first step is to insert a row
    // with status="provisioning"; once Lambda accepts the Event invoke
    // we can return immediately and let the client poll the registry.
    // RequestResponse would hold this connection for 30-90s while the
    // provisioner walked S3 + KB + index + tables + secret, which
    // Amplify SSR's ~29s timeout would kill — the exact "timeout but
    // the brain was actually provisioned" confusion that prompted the
    // switch.
    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: PROVISIONER_FN_NAME,
        InvocationType: "Event",
        Payload: new TextEncoder().encode(
          JSON.stringify({
            action: "create",
            brain_id: brainId,
            display_name: displayName,
            description,
            org_id: auth.orgId,
            created_by: auth.userId,
            created_by_email: createdByEmail,
            embedding_model_provider: sel.provider,
            embedding_model_id: sel.modelId,
            embedding_model_arn: sel.modelArn,
            embedding_dimensions: sel.dimensions,
            embedding_chunking: sel.chunking,
          })
        ),
      })
    );

    // Synthetic provisioning row so the client has something to render
    // and start polling against immediately. The provisioner will write
    // the canonical row to DDB within seconds; the page's next refresh
    // surfaces the real one (and eventually flips to ready/error).
    return NextResponse.json(
      {
        brain: publicBrain({
          brain_id: brainId,
          display_name: displayName,
          description: description ?? null,
          status: "provisioning",
          created_at: new Date().toISOString(),
          created_by_email: createdByEmail ?? null,
        }),
      },
      { status: 202 }
    );
  } catch (err) {
    console.error("brains/create failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
