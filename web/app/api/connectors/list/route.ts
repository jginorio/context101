import { NextResponse } from "next/server";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";

import {
  CONNECTORS_TABLE,
  ddbConnectors,
  type Connector,
} from "@/utils/connectors";

/**
 * GET /api/connectors/list
 *
 * Returns every row in the connectors table, sorted by created_at desc.
 * At our volume (tens of rows) a Scan is fine — cheaper than a GSI per
 * status for a simple list view.
 */
export async function GET() {
  if (!CONNECTORS_TABLE) {
    return NextResponse.json(
      { error: "CONNECTORS_TABLE env var is not set" },
      { status: 500 }
    );
  }

  try {
    const res = await ddbConnectors.send(
      new ScanCommand({ TableName: CONNECTORS_TABLE })
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
