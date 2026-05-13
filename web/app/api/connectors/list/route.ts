import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";

import { resolveBrainFromRequest } from "@/lib/brains-server";
import {
  connectorsTableForBrain,
  ddbConnectors,
  type Connector,
} from "@/utils/connectors";

/**
 * GET /api/connectors/list[?brain=<id>]
 *
 * Returns every row in the active brain's connectors table, sorted by
 * created_at desc. At our volume (tens of rows) a Scan is fine.
 */
export async function GET(request: NextRequest) {
  const r = await resolveBrainFromRequest(request);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const table = connectorsTableForBrain(r.brain);

  try {
    const res = await ddbConnectors.send(
      new ScanCommand({ TableName: table })
    );
    const items = ((res.Items ?? []) as Connector[]).sort((a, b) =>
      (b.created_at ?? "").localeCompare(a.created_at ?? "")
    );
    // Don't leak the secret ARN to the client
    const safe = items.map(({ token_secret_arn: _, ...rest }) => rest);
    return NextResponse.json({ items: safe });
  } catch (err) {
    console.error("connectors list failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
