import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getSetupAuth } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { invitation, user } from "@/lib/db/auth-schema";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * Create an account for someone who was invited to an organization but does
 * not have an account yet.
 *
 * Public signup may be disabled globally (self-hosted default), so we use the
 * signup-enabled auth runtime here — but only after verifying there is a valid
 * pending invitation for the email. The account is always created with the
 * invitation's email (the client cannot choose it), so this endpoint can only
 * ever create accounts that were explicitly invited.
 *
 * On success we return Better Auth's signup response (with Set-Cookie), so the
 * client is signed in and can immediately accept the invitation.
 */
export async function POST(request: Request, ctx: RouteCtx) {
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

  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.name !== "string" ||
    typeof body.password !== "string"
  ) {
    return NextResponse.json(
      { error: "name and password are required" },
      { status: 400 }
    );
  }

  const [inv] = await db
    .select({
      email: invitation.email,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
    })
    .from(invitation)
    .where(eq(invitation.id, id))
    .limit(1);

  if (!inv) {
    return NextResponse.json({ error: "invitation not found" }, { status: 404 });
  }
  if (inv.status !== "pending") {
    return NextResponse.json(
      { error: "this invitation is no longer pending" },
      { status: 409 }
    );
  }
  if (inv.expiresAt.getTime() < Date.now()) {
    return NextResponse.json(
      { error: "this invitation has expired" },
      { status: 410 }
    );
  }

  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, inv.email))
    .limit(1);
  if (existing) {
    return NextResponse.json(
      { error: "an account already exists for this email — sign in instead" },
      { status: 409 }
    );
  }

  const auth = getSetupAuth();
  return (await auth.api.signUpEmail({
    body: {
      name: body.name.trim() || inv.email,
      email: inv.email,
      password: body.password,
    },
    asResponse: true,
  })) as Response;
}
