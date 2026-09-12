import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { readAuthContext, resolveBrainFromRequest } from "@/lib/brains-server";
import { ConflictFailure, rejectConflict } from "@/lib/conflicts";
import { failStatus } from "@/lib/conflicts/parse";

export async function POST(request: NextRequest) {
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const r = await resolveBrainFromRequest(request);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  const body = await request.json().catch(() => null);
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    await rejectConflict(
      { orgId: auth.orgId, brainId: r.brain.brain_id },
      body.id,
      { id: auth.userId, email: auth.userEmail }
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ConflictFailure) {
      return NextResponse.json(
        { error: err.fail.kind, fail: err.fail },
        { status: failStatus(err.fail) }
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
