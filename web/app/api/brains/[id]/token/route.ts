import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getBrainById } from "@/lib/brains-server";

const secrets = new SecretsManagerClient({
  region: process.env.AWS_REGION ?? "us-east-1",
});

/**
 * GET /api/brains/<id>/token
 *
 * Returns the brain's bearer token for the MCP service. Reads the value
 * from Secrets Manager via the SSR compute role; the token is NEVER
 * exposed via `NEXT_PUBLIC_*` env, so the only path for a browser to
 * see it is this signed-in route.
 *
 * Auth: proxy.ts gates `/api/*` behind a valid Cognito session. Any
 * authenticated user can read any brain's token (matches today's
 * permission model where logged-in users have full admin access). When
 * we add per-brain RBAC, add a check here.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const brain = await getBrainById(id);
  if (!brain) {
    return NextResponse.json({ error: "brain not found" }, { status: 404 });
  }
  if (brain.status !== "ready") {
    return NextResponse.json(
      { error: `brain is ${brain.status}, not ready` },
      { status: 409 }
    );
  }
  if (!brain.token_secret_arn) {
    return NextResponse.json(
      { error: "brain has no token secret configured" },
      { status: 503 }
    );
  }
  try {
    const res = await secrets.send(
      new GetSecretValueCommand({ SecretId: brain.token_secret_arn })
    );
    const token = res.SecretString ?? "";
    if (!token) {
      return NextResponse.json(
        { error: "token secret is empty" },
        { status: 503 }
      );
    }
    return NextResponse.json({ brain_id: id, token });
  } catch (err) {
    console.error("brains/[id]/token failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
