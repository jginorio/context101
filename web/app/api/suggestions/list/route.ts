import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { readAuthContext, resolveBrainFromRequest } from "@/lib/brains-server";
import {
  pgListSuggestions,
  toClientSuggestion,
  type SuggestionStatus,
} from "@/utils/suggestions";

/**
 * GET /api/suggestions/list?status=pending|accepted|rejected|all[&brain=<id>]
 *
 * Lists the active brain's suggestions from Postgres (org-scoped),
 * newest first.
 */
export async function GET(request: NextRequest) {
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const r = await resolveBrainFromRequest(request);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  const status = request.nextUrl.searchParams.get("status") ?? "pending";
  if (
    status !== "all" &&
    status !== "pending" &&
    status !== "accepted" &&
    status !== "rejected"
  ) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  try {
    const rows = await pgListSuggestions(
      auth.orgId,
      r.brain.brain_id,
      status === "all" ? undefined : (status as SuggestionStatus)
    );
    return NextResponse.json({ items: rows.map(toClientSuggestion) });
  } catch (err) {
    console.error("list suggestions failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
