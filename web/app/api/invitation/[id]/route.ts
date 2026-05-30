import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { invitation, organization, user } from "@/lib/db/auth-schema";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * Public lookup for an invitation by id. Returns just enough for the
 * accept-invitation page to render the right flow (sign in vs create
 * account) without leaking anything sensitive. No auth required — the
 * invitation id is the capability, exactly like the accept link itself.
 */
export async function GET(_request: Request, ctx: RouteCtx) {
  if (!db) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured" },
      { status: 503 }
    );
  }
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "missing invitation id" }, { status: 400 });
  }

  const [inv] = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      orgName: organization.name,
    })
    .from(invitation)
    .innerJoin(organization, eq(invitation.organizationId, organization.id))
    .where(eq(invitation.id, id))
    .limit(1);

  if (!inv) {
    return NextResponse.json({ error: "invitation not found" }, { status: 404 });
  }

  const expired = inv.expiresAt.getTime() < Date.now();

  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, inv.email))
    .limit(1);

  return NextResponse.json({
    email: inv.email,
    role: inv.role,
    orgName: inv.orgName,
    status: inv.status,
    expired,
    hasAccount: !!existing,
  });
}
