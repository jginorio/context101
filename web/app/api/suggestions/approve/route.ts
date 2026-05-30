import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";

import { readAuthContext, resolveBrainFromRequest } from "@/lib/brains-server";
import { bucketForBrain, s3 } from "@/utils/s3";
import {
  pgGetSuggestion,
  pgMarkSuggestionAccepted,
} from "@/utils/suggestions";

/**
 * POST /api/suggestions/approve[?brain=<id>]
 * Body: { id: string, target_path?: string }
 *
 * Both the suggestion row and the destination S3 file live in the same
 * brain — there is no cross-brain approval. The request's brain id is
 * the single resolver for both lookups.
 *
 * 1. Load the suggestion.
 * 2. Determine the destination S3 key:
 *    - If the request body overrides target_path, use that.
 *    - Else if the suggestion has target_path (update case), use that.
 *    - Else generate one from a slugified title at root.
 * 3. PutObject on the brain's docs bucket.
 * 4. Mark the suggestion accepted.
 */
export async function POST(request: NextRequest) {
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const r = await resolveBrainFromRequest(request);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const bucket = bucketForBrain(r.brain);

  const body = await request.json().catch(() => null);
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const suggestion = await pgGetSuggestion(
      auth.orgId,
      r.brain.brain_id,
      body.id
    );
    if (!suggestion) {
      return NextResponse.json({ error: "suggestion not found" }, { status: 404 });
    }
    if (suggestion.status !== "pending") {
      return NextResponse.json(
        { error: `suggestion is already ${suggestion.status}` },
        { status: 409 }
      );
    }

    // Pick the destination path
    const override: string | undefined =
      typeof body.target_path === "string" && body.target_path.trim()
        ? body.target_path.trim()
        : undefined;
    const destKey =
      override ??
      suggestion.targetPath ??
      `${slugify(suggestion.title)}.md`;

    if (destKey.startsWith("/") || destKey.includes("..")) {
      return NextResponse.json(
        { error: "invalid target_path" },
        { status: 400 }
      );
    }

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: destKey,
        Body: suggestion.content,
        ContentType: "text/markdown; charset=utf-8",
      })
    );

    await pgMarkSuggestionAccepted(
      auth.orgId,
      r.brain.brain_id,
      body.id,
      destKey,
      auth.userEmail ?? auth.userId
    );

    return NextResponse.json({ ok: true, destKey });
  } catch (err) {
    console.error("approve suggestion failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "suggestion"
  );
}
