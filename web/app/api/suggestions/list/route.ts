import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

import { resolveBrainFromRequest } from "@/lib/brains-server";
import { ddb, suggestionsTableForBrain, type Suggestion } from "@/utils/suggestions";

/**
 * GET /api/suggestions/list?status=pending|accepted|rejected|all[&brain=<id>]
 *
 * Uses the GSI `status-created_at-index` to return newest first.
 * When status=all, falls back to a table scan (fine at this volume).
 * Scoped to the active brain's suggestions table.
 */
export async function GET(request: NextRequest) {
  const r = await resolveBrainFromRequest(request);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const table = suggestionsTableForBrain(r.brain);

  const status = request.nextUrl.searchParams.get("status") ?? "pending";

  try {
    if (status === "all") {
      const res = await ddb.send(new ScanCommand({ TableName: table }));
      const items = ((res.Items ?? []) as Suggestion[]).sort((a, b) =>
        (b.created_at ?? "").localeCompare(a.created_at ?? "")
      );
      return NextResponse.json({ items });
    }

    if (status !== "pending" && status !== "accepted" && status !== "rejected") {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }

    const res = await ddb.send(
      new QueryCommand({
        TableName: table,
        IndexName: "status-created_at-index",
        KeyConditionExpression: "#s = :s",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":s": status },
        ScanIndexForward: false, // newest first
      })
    );
    return NextResponse.json({ items: (res.Items ?? []) as Suggestion[] });
  } catch (err) {
    console.error("list suggestions failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
