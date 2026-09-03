import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { resolveBrainFromRequest } from "@/lib/brains-server";
import { retrieveSources } from "@/lib/wiki-retrieve";

/**
 * POST /api/wiki/retrieve
 * Body: { message: string, includeRaw?: boolean }
 *
 * Same Bedrock Retrieve as `/api/wiki/chat`, without the Claude answer.
 * Returns `{ sources: [{ n, key, score, text }] }` so a client can see
 * which S3 keys the vector index currently ranks for a query.
 */
export async function POST(request: NextRequest) {
  const resolved = await resolveBrainFromRequest(request);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: resolved.error },
      { status: resolved.status }
    );
  }
  const brain = resolved.brain;
  if (!brain.kb_id) {
    return NextResponse.json(
      { error: "this brain has no knowledge base yet" },
      { status: 409 }
    );
  }

  const body = await request.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }
  const includeRaw = body?.includeRaw === true;

  try {
    const sources = await retrieveSources({
      knowledgeBaseId: brain.kb_id,
      query: message,
      includeRaw,
    });
    return NextResponse.json({ sources });
  } catch (err) {
    return NextResponse.json(
      {
        error: `retrieval failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 }
    );
  }
}
