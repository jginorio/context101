import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";

import { readAuthContext } from "@/lib/brains-server";
import { db } from "@/lib/db/client";
import { member, session } from "@/lib/db/auth-schema";

const PRIVILEGED_ROLES = ["admin", "owner"];

/**
 * POST /api/org/remove-member
 * Body: { memberId: string }
 *
 * Removes a member from the caller's active organization. Unlike the plain
 * Better Auth client call, this also:
 *   - requires the caller to be an admin/owner,
 *   - refuses to remove the last admin (so the org can't be orphaned),
 *   - revokes the removed user's sessions for this org, so a removed member
 *     is logged out immediately instead of riding their existing session.
 */
export async function POST(request: NextRequest) {
  if (!db) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured" },
      { status: 500 }
    );
  }

  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const memberId = body && typeof body.memberId === "string" ? body.memberId : "";
  if (!memberId) {
    return NextResponse.json({ error: "memberId is required" }, { status: 400 });
  }

  // Caller must be an admin/owner of the active org.
  const [caller] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, auth.userId), eq(member.organizationId, auth.orgId)))
    .limit(1);
  if (!caller || !PRIVILEGED_ROLES.includes(caller.role)) {
    return NextResponse.json(
      { error: "only organization admins can remove members" },
      { status: 403 }
    );
  }

  // Target member must belong to the same org.
  const [target] = await db
    .select({ id: member.id, userId: member.userId, role: member.role })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, auth.orgId)))
    .limit(1);
  if (!target) {
    return NextResponse.json({ error: "member not found" }, { status: 404 });
  }

  // Don't orphan the org: refuse to remove the last admin/owner.
  if (PRIVILEGED_ROLES.includes(target.role)) {
    const admins = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, auth.orgId),
          inArray(member.role, PRIVILEGED_ROLES)
        )
      );
    if (admins.length <= 1) {
      return NextResponse.json(
        { error: "Cannot remove the last admin. Promote another member first." },
        { status: 400 }
      );
    }
  }

  // Remove membership, then revoke their sessions scoped to this org so the
  // removal takes effect immediately (not just on next login).
  await db
    .delete(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, auth.orgId)));

  await db
    .delete(session)
    .where(
      and(
        eq(session.userId, target.userId),
        eq(session.activeOrganizationId, auth.orgId)
      )
    );

  return NextResponse.json({ ok: true });
}
