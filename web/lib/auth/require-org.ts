import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";

import { getAuth } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { member } from "@/lib/db/auth-schema";

/**
 * Server guard for the authenticated app: require the signed-in user to have
 * an active organization they're still a member of, otherwise send them to the
 * org chooser. Brand-new users have no org yet and must join one at
 * `/orgs` before reaching brain-scoped pages. Self-host may also create
 * an org there; Hosted only allows joining an invited org.
 *
 * The proxy already redirects unauthenticated requests to `/login`; this adds
 * the org requirement on top of that.
 */
export async function requireActiveOrg(): Promise<void> {
  // Without a database we can't verify anything; let pages surface their own
  // "not configured" states rather than redirect-looping.
  if (!db) return;
  const database = db;

  const session = (await getAuth()
    .api.getSession({ headers: await headers() })
    .catch(() => null)) as {
    user?: { id?: string };
    session?: { activeOrganizationId?: string | null };
  } | null;

  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const activeOrg = session?.session?.activeOrganizationId ?? null;
  if (!activeOrg) redirect("/orgs");

  const [row] = await database
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, activeOrg)))
    .limit(1);
  if (!row) redirect("/orgs");
}
