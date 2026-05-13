import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { listAllBrains, listReadyBrains, publicBrain } from "@/lib/brains-server";

/**
 * GET /api/brains/list
 * GET /api/brains/list?status=all|ready
 *
 * Returns the registry catalog. Default is status=ready (what the header
 * switcher renders); status=all is for the /brains admin page so it can
 * show in-flight provisioning and errored rows too.
 *
 * Per-brain resource handles (bucket, KB id, table names, token ARN)
 * are stripped before returning — clients only see id + display name +
 * status. SSR routes look up the handles themselves via the brain id.
 */
export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status") ?? "ready";
  try {
    const rows = status === "all" ? await listAllBrains() : await listReadyBrains();
    return NextResponse.json({ items: rows.map(publicBrain) });
  } catch (err) {
    console.error("brains/list failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
