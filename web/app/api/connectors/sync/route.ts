import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { InvokeCommand } from "@aws-sdk/client-lambda";

import {
  connectorsTableForBrain,
  ddbConnectors,
  lambdaClient,
  syncFnNameFor,
  type Connector,
} from "@/utils/connectors";
import { resolveBrainFromRequest } from "@/lib/brains-server";
import { bucketForBrain } from "@/utils/s3";

/**
 * POST /api/connectors/sync[?brain=<id>]
 * Body: { id: string }
 *
 * Fire-and-forget invoke of the per-type sync Lambda, scoped to the
 * active brain. The Lambda writes the status back to the Dynamo row;
 * the UI polls /api/connectors/list to show progress.
 */
export async function POST(request: NextRequest) {
  const r = await resolveBrainFromRequest(request);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const connectorsTable = connectorsTableForBrain(r.brain);
  const docsBucket = bucketForBrain(r.brain);

  const body = await request.json().catch(() => null);
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const got = await ddbConnectors.send(
      new GetCommand({ TableName: connectorsTable, Key: { id: body.id } })
    );
    const row = got.Item as Connector | undefined;
    if (!row) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const fn = syncFnNameFor(row.type);
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
          JSON.stringify({
            connectorId: row.id,
            connectorsTable,
            docsBucket,
            brainId: r.brain.brain_id,
          })
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
