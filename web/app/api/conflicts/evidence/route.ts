import { createHash } from "node:crypto";
import { and, eq, isNull, or, gt } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { readAuthContext, resolveBrainFromRequest } from "@/lib/brains-server";
import { db } from "@/lib/db/client";
import { mcpTokens } from "@/lib/db/schema";
import {
  getBrainByDocsBucket,
  parseEvidenceReport,
  reportEvidence,
  type ConflictScope,
} from "@/lib/conflicts";
import { ParseError } from "@/lib/conflicts/parse";

function ingestSecret(): string | null {
  return process.env.CONFLICT_EVIDENCE_SECRET || process.env.MCP_TOKEN_PEPPER || null;
}

function hashMcpToken(raw: string): string | null {
  const pepper = process.env.MCP_TOKEN_PEPPER;
  if (!pepper) return null;
  return createHash("sha256").update(pepper + raw, "utf8").digest("hex");
}

async function scopeFromMcpBearer(
  request: NextRequest
): Promise<ConflictScope | null> {
  const header = request.headers.get("authorization") ?? "";
  const presented = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  if (!presented || !db) return null;
  const hashed = hashMcpToken(presented);
  if (!hashed) return null;
  const brainHint =
    request.headers.get("x-brain-id") ??
    request.nextUrl.searchParams.get("brain");
  const filters = [
    eq(mcpTokens.hashedToken, hashed),
    isNull(mcpTokens.revokedAt),
    or(isNull(mcpTokens.expiresAt), gt(mcpTokens.expiresAt, new Date())),
  ];
  if (brainHint) filters.push(eq(mcpTokens.brainId, brainHint));
  const [row] = await db
    .select({
      orgId: mcpTokens.orgId,
      brainId: mcpTokens.brainId,
    })
    .from(mcpTokens)
    .where(and(...filters))
    .limit(1);
  if (!row) return null;
  return { orgId: row.orgId, brainId: row.brainId };
}

function ingestAuthorized(request: NextRequest): boolean {
  const expected = ingestSecret();
  if (!expected) return false;
  const header = request.headers.get("x-conflict-ingest-secret");
  return !!header && header === expected;
}

export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  let report;
  try {
    report = parseEvidenceReport(raw);
  } catch (err) {
    const msg = err instanceof ParseError ? err.message : "invalid body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  let scope: ConflictScope | null = null;
  const auth = await readAuthContext(request);
  if (auth) {
    const r = await resolveBrainFromRequest(request);
    if (r.ok) scope = { orgId: auth.orgId, brainId: r.brain.brain_id };
  }
  if (!scope) scope = await scopeFromMcpBearer(request);
  if (!scope && ingestAuthorized(request) && report.via === "ingest") {
    scope = await getBrainByDocsBucket(report.bucket);
  }
  if (!scope) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  void reportEvidence(scope, report).catch((err) =>
    console.error("conflict evidence:", err)
  );
  return NextResponse.json({ ok: true });
}
