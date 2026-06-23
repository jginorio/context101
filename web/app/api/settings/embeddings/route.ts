import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";

import { readAuthContext } from "@/lib/brains-server";
import { db } from "@/lib/db/client";
import { brains } from "@/lib/db/schema";
import { member } from "@/lib/db/auth-schema";
import {
  DEFAULT_CHUNKING,
  DEFAULT_EMBEDDING_DIMENSION,
  DEFAULT_EMBEDDING_MODEL_ID,
  embeddingModelLabel,
  inferEmbeddingProvider,
  resolveEmbeddingSelection,
} from "@/lib/embedding-models";

const AWS_REGION = process.env.AWS_REGION ?? "us-east-1";
const PROVISIONER_FN_NAME = process.env.BRAIN_PROVISIONER_FN_NAME ?? "";
const lambdaClient = new LambdaClient({ region: AWS_REGION });

async function loadBrain(orgId: string, brainId: string) {
  if (!db) return null;
  const [row] = await db
    .select()
    .from(brains)
    .where(and(eq(brains.orgId, orgId), eq(brains.id, brainId)))
    .limit(1);
  return row ?? null;
}

async function isPrivileged(userId: string, orgId: string): Promise<boolean> {
  if (!db) return false;
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
    .limit(1);
  return row?.role === "admin" || row?.role === "owner";
}

/**
 * GET /api/settings/embeddings?brain=<id>
 *
 * Returns the brain's current embedding model + chunking config. Falls back
 * to the deploy-time default (Titan v2 @ 1024, Bedrock-managed chunking) for
 * brains provisioned before per-brain embedding selection existed.
 */
export async function GET(request: NextRequest) {
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const brainId = request.nextUrl.searchParams.get("brain");
  if (!brainId) {
    return NextResponse.json({ error: "brain is required" }, { status: 400 });
  }
  const brain = await loadBrain(auth.orgId, brainId);
  if (!brain) {
    return NextResponse.json({ error: "brain not found" }, { status: 404 });
  }

  const modelId = brain.embeddingModelId ?? DEFAULT_EMBEDDING_MODEL_ID;
  return NextResponse.json({
    provider:
      brain.embeddingModelProvider ?? inferEmbeddingProvider(modelId) ?? "aws",
    model_id: modelId,
    model_label: embeddingModelLabel(modelId),
    dimensions: brain.embeddingDimensions ?? DEFAULT_EMBEDDING_DIMENSION,
    chunking: brain.embeddingChunking ?? DEFAULT_CHUNKING,
  });
}

/**
 * POST /api/settings/embeddings
 * Body: { brainId, provider, modelId, dimensions?, chunkingConfig? }
 *
 * Admin/owner only. Re-embeds the brain *in place* under the new model and
 * (for Cohere) chunking strategy. A brain's KB embedding model + vector
 * dimension are immutable, so the provisioner swaps the underlying KB / vector
 * index / docs bucket beneath the brain — but the brain id, bearer token,
 * connectors, suggestions, and MCP URL are all preserved, so externally
 * configured MCP clients keep working. The current KB keeps serving queries
 * until the swap completes (zero downtime). Fire-and-forget: the work runs in
 * the provisioner Lambda; the client polls GET to detect completion.
 */
export async function POST(request: NextRequest) {
  if (!PROVISIONER_FN_NAME) {
    return NextResponse.json(
      { error: "BRAIN_PROVISIONER_FN_NAME env var is not set" },
      { status: 500 }
    );
  }
  if (!db) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured" },
      { status: 500 }
    );
  }
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  if (!(await isPrivileged(auth.userId, auth.orgId))) {
    return NextResponse.json(
      { error: "only organization admins can change a brain's embeddings" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const brainId = typeof body?.brainId === "string" ? body.brainId : "";
  if (!brainId) {
    return NextResponse.json({ error: "brainId is required" }, { status: 400 });
  }

  const embedding = resolveEmbeddingSelection(
    {
      provider: body?.provider,
      modelId: body?.modelId,
      dimensions: body?.dimensions,
      chunkingConfig: body?.chunkingConfig,
    },
    AWS_REGION
  );
  if (!embedding.ok) {
    return NextResponse.json({ error: embedding.error }, { status: 400 });
  }
  const sel = embedding.selection;

  const brain = await loadBrain(auth.orgId, brainId);
  if (!brain) {
    return NextResponse.json({ error: "brain not found" }, { status: 404 });
  }
  if (brain.status !== "ready") {
    return NextResponse.json(
      { error: `brain is ${brain.status}, not ready` },
      { status: 409 }
    );
  }

  try {
    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: PROVISIONER_FN_NAME,
        InvocationType: "Event",
        Payload: new TextEncoder().encode(
          JSON.stringify({
            action: "reembed",
            brain_id: brainId,
            org_id: auth.orgId,
            embedding_model_provider: sel.provider,
            embedding_model_id: sel.modelId,
            embedding_model_arn: sel.modelArn,
            embedding_dimensions: sel.dimensions,
            embedding_configurable_dims: sel.configurableDimensions,
            embedding_chunking: sel.chunking,
          })
        ),
      })
    );
    return NextResponse.json({ ok: true, brain_id: brainId }, { status: 202 });
  } catch (err) {
    console.error("embeddings reembed failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
