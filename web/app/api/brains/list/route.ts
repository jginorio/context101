import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  listBrainsForOrg,
  listReadyBrainsForOrg,
  publicBrain,
  readAuthContext,
} from "@/lib/brains-server";

/**
 * GET /api/brains/list
 * GET /api/brains/list?status=all|ready
 *
 * Returns the org's brain catalog from Postgres. Default is status=ready
 * (what the header switcher renders); status=all is for the /brains admin
 * page so it can show in-flight provisioning and errored rows too.
 *
 * Per-brain resource handles (bucket, KB id, token ARN) are stripped before
 * returning — clients only see id + display name + status.
 */
export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status") ?? "ready";
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  try {
    const brains =
      status === "all"
        ? await listBrainsForOrg(auth.orgId)
        : await listReadyBrainsForOrg(auth.orgId);
    return NextResponse.json({ items: brains.map(publicBrain) });
  } catch (err) {
    console.error("brains/list failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
