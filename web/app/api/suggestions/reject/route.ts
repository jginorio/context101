import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { readAuthContext, resolveBrainFromRequest } from "@/lib/brains-server";
import { pgMarkSuggestionRejected } from "@/utils/suggestions";

/**
 * POST /api/suggestions/reject[?brain=<id>]
 * Body: { id: string }
 *
 * Flips a pending suggestion to `rejected` in Postgres (org-scoped). The
 * row stays for audit (we don't delete — easy to revisit later). Returns
 * 409 if the suggestion was already reviewed.
 */
export async function POST(request: NextRequest) {
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const r = await resolveBrainFromRequest(request);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  const body = await request.json().catch(() => null);
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const ok = await pgMarkSuggestionRejected(
      auth.orgId,
      r.brain.brain_id,
      body.id,
      auth.userEmail ?? auth.userId
    );
    if (!ok) {
      return NextResponse.json(
        { error: "suggestion not found or already reviewed" },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
