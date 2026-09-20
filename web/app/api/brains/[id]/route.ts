import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";

import {
  getBrainByIdForOrg,
  publicBrain,
  readAuthContext,
  deniedAuthJson,
} from "@/lib/brains-server";
import { db } from "@/lib/db/client";
import { brains as brainsTable } from "@/lib/db/schema";

const PROVISIONER_FN_NAME = process.env.BRAIN_PROVISIONER_FN_NAME ?? "";
const lambdaClient = new LambdaClient({
  region: process.env.AWS_REGION ?? "us-east-1",
});

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * GET /api/brains/<id>
 *
 * Returns the registry row for a single brain. Used by the /brains admin
 * page to poll a brain's status during provisioning (status flips
 * provisioning → ready), and by anyone deep-linking to a specific brain.
 *
 * The response is stripped of internal handles via `publicBrain`.
 */
export async function GET(request: NextRequest, { params }: RouteCtx) {
  const { id } = await params;
  const auth = await readAuthContext(request);
  if (!auth.ok) return deniedAuthJson(auth);

  const brain = await getBrainByIdForOrg(auth.orgId, id);
  if (!brain) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ brain: publicBrain(brain) });
}

/**
 * DELETE /api/brains/<id>
 *
 * Refuses for brain_id="default". For any other brain, flips the registry
 * row to `deleting` and fire-and-forgets BrainProvisionerFn — that empties
 * + deletes the S3 bucket, deletes the KB + data source + vector index,
 * deletes the bearer-token secret, and removes the registry row. The web
 * UI polls until the row disappears.
 *
 * Event (not RequestResponse) so Amplify SSR's ~29s timeout cannot kill
 * the HTTP request mid-teardown. The provisioner is idempotent; a stuck
 * `deleting` / `error` row can be retried.
 */
export async function DELETE(request: NextRequest, { params }: RouteCtx) {
  if (!PROVISIONER_FN_NAME) {
    return NextResponse.json(
      { error: "BRAIN_PROVISIONER_FN_NAME env var is not set" },
      { status: 500 }
    );
  }
  const auth = await readAuthContext(request);
  if (!auth.ok) return deniedAuthJson(auth);
  const { id } = await params;
  if (id === "default") {
    return NextResponse.json(
      { error: "the default brain cannot be deleted" },
      { status: 400 }
    );
  }
  const brain = await getBrainByIdForOrg(auth.orgId, id);
  if (!brain) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    // Pre-flip so the /brains card shows Deleting… immediately, the same
    // way create pre-inserts a provisioning row before the Event invoke.
    if (db) {
      await db
        .update(brainsTable)
        .set({ status: "deleting", errorMsg: null, updatedAt: new Date() })
        .where(and(eq(brainsTable.orgId, auth.orgId), eq(brainsTable.id, id)));
    }

    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: PROVISIONER_FN_NAME,
        InvocationType: "Event",
        Payload: new TextEncoder().encode(
          JSON.stringify({ action: "delete", brain_id: id, org_id: auth.orgId })
        ),
      })
    );
    return NextResponse.json({ ok: true, brain_id: id }, { status: 202 });
  } catch (err) {
    console.error("brains/[id] DELETE failed:", err);
    if (db) {
      const msg = err instanceof Error ? err.message : String(err);
      await db
        .update(brainsTable)
        .set({
          status: "error",
          errorMsg: `delete failed: ${msg}`.slice(0, 1000),
          updatedAt: new Date(),
        })
        .where(and(eq(brainsTable.orgId, auth.orgId), eq(brainsTable.id, id)))
        .catch((e2) => console.error("also failed to update error status:", e2));
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
