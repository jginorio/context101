import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";

import { hashPassword } from "@/lib/auth/server";
import { readAuthContext } from "@/lib/brains-server";
import { db } from "@/lib/db/client";
import { account, member, session } from "@/lib/db/auth-schema";

const PRIVILEGED_ROLES = ["admin", "owner"];
const CREDENTIAL_PROVIDER = "credential";

/**
 * POST /api/org/reset-password
 * Body: { memberId: string, password: string }
 *
 * Lets an org admin/owner set a new password for another member of the same
 * organization (e.g. a teammate locked out, no email-based reset infra yet).
 *
 * Better Auth has no first-party API to set another user's password without
 * the admin plugin, so we hash with Better Auth's own hasher and write the
 * `account` row directly, then revoke the target's sessions so they must sign
 * in again with the new password.
 */
export async function POST(request: NextRequest) {
  if (!db) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured" },
      { status: 500 }
    );
  }
  const database = db;

  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const memberId =
    body && typeof body.memberId === "string" ? body.memberId : "";
  const password =
    body && typeof body.password === "string" ? body.password : "";
  if (!memberId || !password) {
    return NextResponse.json(
      { error: "memberId and password are required" },
      { status: 400 }
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "password must be at least 8 characters" },
      { status: 400 }
    );
  }

  // Caller must be an admin/owner of the active org.
  const [caller] = await database
    .select({ role: member.role })
    .from(member)
    .where(
      and(eq(member.userId, auth.userId), eq(member.organizationId, auth.orgId))
    )
    .limit(1);
  if (!caller || !PRIVILEGED_ROLES.includes(caller.role)) {
    return NextResponse.json(
      { error: "only organization admins can reset passwords" },
      { status: 403 }
    );
  }

  // Target member must belong to the same org.
  const [target] = await database
    .select({ userId: member.userId })
    .from(member)
    .where(
      and(eq(member.id, memberId), eq(member.organizationId, auth.orgId))
    )
    .limit(1);
  if (!target) {
    return NextResponse.json({ error: "member not found" }, { status: 404 });
  }

  // Find the email/password credential account for the target user.
  const [cred] = await database
    .select({ id: account.id })
    .from(account)
    .where(
      and(
        eq(account.userId, target.userId),
        eq(account.providerId, CREDENTIAL_PROVIDER)
      )
    )
    .limit(1);
  if (!cred) {
    return NextResponse.json(
      { error: "this member doesn't use email/password sign-in" },
      { status: 400 }
    );
  }

  const hashed = await hashPassword(password);
  await database
    .update(account)
    .set({ password: hashed, updatedAt: new Date() })
    .where(eq(account.id, cred.id));

  // Force re-login everywhere with the new password.
  await database.delete(session).where(eq(session.userId, target.userId));

  return NextResponse.json({ ok: true });
}
