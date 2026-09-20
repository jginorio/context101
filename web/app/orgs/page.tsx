import * as React from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { hostedOrgAccess } from "@/lib/auth/hosted-org-entitlement";
import { orgsChooserCopy } from "@/lib/auth/hosted-org-policy";
import { getAuth } from "@/lib/auth/server";
import { deploymentConfig } from "@/lib/deployment/config";
import { db } from "@/lib/db/client";
import { member, organization } from "@/lib/db/auth-schema";
import { OrgChooser } from "@/components/org-chooser";

type SearchParams = Promise<{ next?: string }>;

async function OrgsContent({ searchParams }: { searchParams: SearchParams }) {
  if (!db) redirect("/login");
  const database = db;

  const session = (await getAuth()
    .api.getSession({ headers: await headers() })
    .catch(() => null)) as {
    user?: { id?: string };
    session?: { activeOrganizationId?: string | null };
  } | null;

  const { next } = await searchParams;
  const dest = next && next.startsWith("/") ? next : "/knowledge";

  if (!session?.user?.id) {
    redirect(`/login?next=${encodeURIComponent(`/orgs`)}`);
  }
  const userId = session.user.id;

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

  const copy = orgsChooserCopy({
    isHosted: deploymentConfig.isHosted,
    orgCount: orgs.length,
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {copy.heading}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {copy.description}
          </p>
        </div>
        <OrgChooser
          orgs={orgs}
          activeOrgId={session.session?.activeOrganizationId ?? null}
          next={dest}
          allowCreate={copy.allowCreate}
        />
      </div>
    </main>
  );
}

export default function OrgsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <React.Suspense fallback={null}>
      <OrgsContent searchParams={searchParams} />
    </React.Suspense>
  );
}
