import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { InvokeCommand } from "@aws-sdk/client-lambda";

import {
  lambdaClient,
  pgGetConnector,
  syncFnNameFor,
  type ConnectorType,
} from "@/utils/connectors";
import { readAuthContext, resolveBrainFromRequest } from "@/lib/brains-server";
import { bucketForBrain } from "@/utils/s3";

/**
 * POST /api/connectors/sync[?brain=<id>]
 * Body: { id: string }
 *
 * Fire-and-forget invoke of the per-type sync Lambda, scoped to the active
 * brain. The Lambda writes status back to the Postgres connector row; the
 * UI polls /api/connectors/list to show progress.
 */
export async function POST(request: NextRequest) {
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const r = await resolveBrainFromRequest(request);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const docsBucket = bucketForBrain(r.brain);

  const body = await request.json().catch(() => null);
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const row = await pgGetConnector(auth.orgId, r.brain.brain_id, body.id);
    if (!row) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const fn = syncFnNameFor(row.type as ConnectorType);
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
