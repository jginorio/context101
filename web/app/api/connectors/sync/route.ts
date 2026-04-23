import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { InvokeCommand } from "@aws-sdk/client-lambda";

import {
  CONNECTOR_SYNC_SHEETS_FN_NAME,
  CONNECTORS_TABLE,
  ddbConnectors,
  lambdaClient,
  type Connector,
} from "@/utils/connectors";

/**
 * POST /api/connectors/sync
 * Body: { id: string }
 *
 * Fire-and-forget invoke of the per-type sync Lambda. The Lambda writes
 * the status back to the Dynamo row; the UI polls /api/connectors/list
 * to show progress.
 */
export async function POST(request: NextRequest) {
  if (!CONNECTORS_TABLE) {
    return NextResponse.json(
      { error: "CONNECTORS_TABLE not set" },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const got = await ddbConnectors.send(
      new GetCommand({ TableName: CONNECTORS_TABLE, Key: { id: body.id } })
    );
    const row = got.Item as Connector | undefined;
    if (!row) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const fn =
      row.type === "sheets" ? CONNECTOR_SYNC_SHEETS_FN_NAME : undefined;
    if (!fn) {
      return NextResponse.json(
        { error: `no sync Lambda for type=${row.type}` },
        { status: 500 }
      );
    }

    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: fn,
        InvocationType: "Event",
        Payload: new TextEncoder().encode(
          JSON.stringify({ connectorId: row.id })
        ),
      })
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("sync failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
