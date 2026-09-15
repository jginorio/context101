import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { readAuthContext, resolveBrainFromRequest } from "@/lib/brains-server";
import {
  approveConflict,
  ConflictFailure,
  parseApproveBody,
} from "@/lib/conflicts";
import { failStatus, ParseError } from "@/lib/conflicts/parse";

export async function POST(request: NextRequest) {
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const r = await resolveBrainFromRequest(request);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  const raw = await request.json().catch(() => null);
  let parsed;
  try {
    parsed = parseApproveBody(raw);
  } catch (err) {
    const msg = err instanceof ParseError ? err.message : "invalid body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    const result = await approveConflict(
      { orgId: auth.orgId, brainId: r.brain.brain_id },
      parsed.id,
      parsed.resolution,
      { id: auth.userId, email: auth.userEmail }
    );
    return NextResponse.json({ ok: true, wrote: result.wrote });
  } catch (err) {
    if (err instanceof ConflictFailure) {
      return NextResponse.json(
        { error: err.fail.kind, fail: err.fail },
        { status: failStatus(err.fail) }
      );
    }
    console.error("approve conflict failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
