import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { SUGGESTIONS_TABLE, ddb } from "@/utils/suggestions";

/**
 * POST /api/suggestions/reject
 * Body: { id: string }
 *
 * Flips status to `rejected`. The suggestion stays in the table for
 * audit (we don't delete — easy to revisit later).
 */
export async function POST(request: NextRequest) {
  if (!SUGGESTIONS_TABLE) {
    return NextResponse.json(
      { error: "SUGGESTIONS_TABLE env var is not set" },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: SUGGESTIONS_TABLE,
        Key: { id: body.id },
        UpdateExpression: "SET #s = :s, reviewed_at = :rt",
        ConditionExpression: "#s = :pending",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":s": "rejected",
          ":pending": "pending",
          ":rt": new Date().toISOString(),
        },
      })
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // ConditionExpression fails if already accepted/rejected
    const status = /ConditionalCheckFailed/.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
