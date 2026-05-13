import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getBrainById, publicBrain } from "@/lib/brains-server";
import { getCurrentUserEmail } from "@/utils/amplify-server-utils";

const PROVISIONER_FN_NAME = process.env.BRAIN_PROVISIONER_FN_NAME ?? "";
const lambdaClient = new LambdaClient({
  region: process.env.AWS_REGION ?? "us-east-1",
});

// Slug rules — must match the regex enforced by the provisioner Lambda:
// /^[a-z0-9][a-z0-9-]{0,62}$/. Includes a short random suffix so two
// brains with the same display name don't collide.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function nanoid(len = 5): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz0123456789"; // no l/o/0/1 confusables
  let s = "";
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) s += alphabet[buf[i] % alphabet.length];
  return s;
}

/**
 * POST /api/brains/create
 * Body: { display_name: string, description?: string }
 *
 * Generates a brain_id from the display name + a short random suffix and
 * invokes the BrainProvisionerFn synchronously to provision the per-brain
 * S3 bucket, KB, vector index, DDB tables, and bearer-token secret.
 *
 * Returns the registry row with status="ready" once provisioning succeeds,
 * or status="error" with error_msg if any step failed. The provisioner is
 * idempotent — failed creates can be retried by re-POSTing with the same
 * brain_id (we'd need a separate retry endpoint; v1 just supports first
 * attempts).
 */
export async function POST(request: NextRequest) {
  if (!PROVISIONER_FN_NAME) {
    return NextResponse.json(
      { error: "BRAIN_PROVISIONER_FN_NAME env var is not set" },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => null);
  const displayName =
    body && typeof body.display_name === "string"
      ? body.display_name.trim()
      : "";
  const description =
    body && typeof body.description === "string"
      ? body.description.trim()
      : undefined;

  if (!displayName) {
    return NextResponse.json(
      { error: "display_name is required" },
      { status: 400 }
    );
  }
  if (displayName.length > 80) {
    return NextResponse.json(
      { error: "display_name too long (max 80 chars)" },
      { status: 400 }
    );
  }

  const slug = slugify(displayName);
  if (!slug) {
    return NextResponse.json(
      { error: "display_name must contain at least one alphanumeric character" },
      { status: 400 }
    );
  }
  const brainId = `${slug}-${nanoid()}`;

  const createdBy = await getCurrentUserEmail(request, new NextResponse());

  try {
    const resp = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: PROVISIONER_FN_NAME,
        InvocationType: "RequestResponse",
        Payload: new TextEncoder().encode(
          JSON.stringify({
            action: "create",
            brain_id: brainId,
            display_name: displayName,
            description,
            created_by_email: createdBy,
          })
        ),
      })
    );
    if (resp.FunctionError) {
      const raw = new TextDecoder().decode(resp.Payload ?? new Uint8Array());
      console.error("provisioner returned error:", raw);
      return NextResponse.json(
        { error: `provisioner failed: ${raw}` },
        { status: 500 }
      );
    }
    // Read back the freshly-provisioned row so the client gets the
    // resolved handles in the response (without exposing tokens).
    const row = await getBrainById(brainId);
    if (!row) {
      return NextResponse.json(
        { error: "provisioner ran but registry row not found" },
        { status: 500 }
      );
    }
    return NextResponse.json({ brain: publicBrain(row) }, { status: 201 });
  } catch (err) {
    console.error("brains/create failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
