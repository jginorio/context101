import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { improveDocument } from "@/utils/bedrock";

export const maxDuration = 60; // Opus can be slow; give it up to 60s

/**
 * POST /api/files/improve
 * Body: { key: string, content: string }
 *
 * Sends the document to Claude Opus 4.7 via Bedrock and returns its
 * suggested improvements. Does NOT write anything to S3 — the UI
 * calls /api/files/put separately if the user accepts the changes.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.key !== "string" ||
    typeof body.content !== "string"
  ) {
    return NextResponse.json(
      { error: "key and content are required" },
      { status: 400 }
    );
  }
  if (body.content.length === 0) {
    return NextResponse.json(
      { error: "content is empty — nothing to improve" },
      { status: 400 }
    );
  }
  // Guard against absurdly large requests — cheap sanity cap
  if (body.content.length > 200_000) {
    return NextResponse.json(
      { error: "content too large (>200KB) — split into smaller files" },
      { status: 413 }
    );
  }

  try {
    const result = await improveDocument(body.key, body.content);
    return NextResponse.json(result);
  } catch (err) {
    console.error("improve failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
