import { NextResponse } from "next/server";

import {
  handleHostedProvisionRequest,
  liveHostedProvisionDeps,
} from "@/lib/hosted/http";

/**
 * POST /api/internal/hosted-provision
 *
 * Hosted-only. The marketing storefront calls this after a Creem payment
 * grant so we can create the Better Auth user + organization. Auth is a
 * shared secret (`HOSTED_PROVISION_SECRET`), not a session cookie.
 */
export async function POST(request: Request) {
  const { status, body } = await handleHostedProvisionRequest(
    request,
    liveHostedProvisionDeps()
  );
  return NextResponse.json(body, { status });
}
