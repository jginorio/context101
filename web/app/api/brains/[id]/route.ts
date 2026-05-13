import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getBrainById, publicBrain } from "@/lib/brains-server";

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
export async function GET(_req: NextRequest, { params }: RouteCtx) {
  const { id } = await params;
  const row = await getBrainById(id);
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ brain: publicBrain(row) });
}

/**
 * DELETE /api/brains/<id>
 *
 * Refuses for brain_id="default". For any other brain, invokes the
 * BrainProvisionerFn delete handler — that empties + deletes the S3
 * bucket, deletes the KB + data source + vector index, deletes the per-
 * brain DDB tables, deletes the bearer-token secret, and removes the
 * registry row. The web UI polls the registry until the row disappears.
 */
export async function DELETE(_req: NextRequest, { params }: RouteCtx) {
  if (!PROVISIONER_FN_NAME) {
    return NextResponse.json(
      { error: "BRAIN_PROVISIONER_FN_NAME env var is not set" },
      { status: 500 }
    );
  }
  const { id } = await params;
  if (id === "default") {
    return NextResponse.json(
      { error: "the default brain cannot be deleted" },
      { status: 400 }
    );
  }
  try {
    const resp = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: PROVISIONER_FN_NAME,
        InvocationType: "RequestResponse",
        Payload: new TextEncoder().encode(
          JSON.stringify({ action: "delete", brain_id: id })
        ),
      })
    );
    if (resp.FunctionError) {
      const raw = new TextDecoder().decode(resp.Payload ?? new Uint8Array());
      console.error("provisioner delete returned error:", raw);
      return NextResponse.json(
        { error: `provisioner failed: ${raw}` },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, brain_id: id });
  } catch (err) {
    console.error("brains/[id] DELETE failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
