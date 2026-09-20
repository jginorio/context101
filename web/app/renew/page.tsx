import * as React from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import {
  hostedOrgAccess,
  hostedRenewUrl,
} from "@/lib/auth/hosted-org-entitlement";
import { getAuth } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { member, organization } from "@/lib/db/auth-schema";
import { RenewScreen } from "@/components/renew-screen";

async function RenewContent() {
  if (!db) redirect("/login");
  const database = db;

  const session = (await getAuth()
    .api.getSession({ headers: await headers() })
    .catch(() => null)) as {
    user?: { id?: string };
    session?: { activeOrganizationId?: string | null };
  } | null;

  if (!session?.user?.id) {
    redirect("/login?next=/renew");
  }
  const userId = session.user.id;
  const activeOrgId = session.session?.activeOrganizationId ?? null;

  const rows = await database
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      logo: organization.logo,
      role: member.role,
      metadata: organization.metadata,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId));

  const orgs = rows.map(({ metadata, ...org }) => ({
    ...org,
    softLocked: !hostedOrgAccess(metadata).entitled,
  }));

  const active = orgs.find((org) => org.id === activeOrgId) ?? null;
  if (active && !active.softLocked) {
    redirect("/knowledge");
  }
  if (!activeOrgId || !active) {
    redirect("/orgs");
  }

  const otherOrgs = orgs.filter((org) => org.id !== active.id);
  const renewUrl = hostedRenewUrl();

  return (
    <RenewScreen
      orgName={active.name}
      renewUrl={renewUrl}
      orgs={otherOrgs}
      activeOrgId={active.id}
    />
  );
}

export default function RenewPage() {
  return (
    <React.Suspense fallback={null}>
      <RenewContent />
    </React.Suspense>
  );
}
