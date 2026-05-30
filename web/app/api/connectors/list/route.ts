import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { readAuthContext, resolveBrainFromRequest } from "@/lib/brains-server";
import { pgListConnectors, toClientConnector } from "@/utils/connectors";

/**
 * GET /api/connectors/list[?brain=<id>]
 *
 * Returns every connector for the active brain (Postgres `connectors`,
 * org-scoped), sorted by created_at desc.
 */
export async function GET(request: NextRequest) {
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const r = await resolveBrainFromRequest(request);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  try {
    const rows = await pgListConnectors(auth.orgId, r.brain.brain_id);
    // Don't leak the secret ARN to the client.
    const safe = rows.map((row) => {
      const item = toClientConnector(row);
      delete item.token_secret_arn;
      return item;
    });
    return NextResponse.json({ items: safe });
  } catch (err) {
    console.error("connectors list failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
