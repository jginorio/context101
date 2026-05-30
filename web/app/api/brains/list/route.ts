import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";

import { getAuth } from "@/lib/auth/server";
import { listAllBrains, listReadyBrains, publicBrain } from "@/lib/brains-server";
import { db } from "@/lib/db/client";
import { brains as brainsTable } from "@/lib/db/schema";

type BetterAuthSession = {
  user?: {
    id?: string;
  };
  session?: {
    activeOrganizationId?: string | null;
  };
} | null;

function publicPostgresBrain(row: typeof brainsTable.$inferSelect) {
  return {
    brain_id: row.id,
    display_name: row.displayName,
    description: row.description,
    status: row.status,
    created_at: row.createdAt.toISOString(),
    created_by_email: null,
    error_msg: row.errorMsg,
  };
}

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
    const session = (await getAuth()
      .api.getSession({
        headers: request.headers,
      })
      .catch(() => null)) as BetterAuthSession;
    const userId = session?.user?.id;
    const orgId = session?.session?.activeOrganizationId;

    if (db && userId && orgId) {
      const rows =
        status === "all"
          ? await db
              .select()
              .from(brainsTable)
              .where(eq(brainsTable.orgId, orgId))
          : await db
              .select()
              .from(brainsTable)
              .where(
                and(eq(brainsTable.orgId, orgId), eq(brainsTable.status, "ready"))
              );
      return NextResponse.json({ items: rows.map(publicPostgresBrain) });
    }

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
