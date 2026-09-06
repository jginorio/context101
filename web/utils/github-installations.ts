import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { githubAppInstallations } from "@/lib/db/schema";
import type { GithubInstallationDetails } from "@/utils/github-app";

function requireDb() {
  if (!db) throw new Error("DATABASE_URL is not configured");
  return db;
}

export async function listGithubInstallations(orgId: string) {
  return requireDb()
    .select()
    .from(githubAppInstallations)
    .where(eq(githubAppInstallations.orgId, orgId));
}

export async function getGithubInstallationForOrg(
  orgId: string,
  installationId: string
) {
  const [row] = await requireDb()
    .select()
    .from(githubAppInstallations)
    .where(
      and(
        eq(githubAppInstallations.orgId, orgId),
        eq(githubAppInstallations.installationId, installationId)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function saveGithubInstallation(
  auth: { orgId: string; userId: string },
  details: GithubInstallationDetails
) {
  const database = requireDb();
  const [claimed] = await database
    .select({
      orgId: githubAppInstallations.orgId,
      accountLogin: githubAppInstallations.accountLogin,
    })
    .from(githubAppInstallations)
    .where(
      eq(githubAppInstallations.installationId, details.installationId)
    )
    .limit(1);

  if (claimed && claimed.orgId !== auth.orgId) {
    throw new Error(
      "This GitHub installation is already connected to another Context101 organization"
    );
  }

  await database
    .insert(githubAppInstallations)
    .values({
      installationId: details.installationId,
      orgId: auth.orgId,
      accountLogin: details.accountLogin,
      accountType: details.accountType,
      repositorySelection: details.repositorySelection,
      settingsUrl: details.settingsUrl,
      createdBy: auth.userId,
    })
    .onConflictDoUpdate({
      target: githubAppInstallations.installationId,
      set: {
        accountLogin: details.accountLogin,
        accountType: details.accountType,
        repositorySelection: details.repositorySelection,
        settingsUrl: details.settingsUrl,
        updatedAt: new Date(),
      },
    });
}
