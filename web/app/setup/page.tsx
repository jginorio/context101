import { redirect } from "next/navigation";

import { deploymentConfig } from "@/lib/deployment/config";
import { db } from "@/lib/db/client";
import { organization } from "@/lib/db/auth-schema";
import { SetupOwnerForm } from "@/components/setup-owner-form";

async function hasAnyOrganization() {
  if (!db) return false;
  const rows = await db.select({ id: organization.id }).from(organization).limit(1);
  return rows.length > 0;
}

export default async function SetupPage() {
  if (!deploymentConfig.isSelfHosted) redirect("/login");
  if (await hasAnyOrganization()) redirect("/login");

  if (!db) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4 sm:p-6">
        <div className="w-full max-w-md rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          <h1 className="mb-2 text-lg font-semibold text-foreground">
            Database not configured
          </h1>
          Set <code>DATABASE_URL</code>, <code>BETTER_AUTH_SECRET</code>, and{" "}
          <code>BETTER_AUTH_URL</code> before running first-time setup.
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 sm:p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Set up Context101</h1>
          <p className="text-sm text-muted-foreground">
            Create the first admin account and organization.
          </p>
        </div>
        <SetupOwnerForm />
      </div>
    </main>
  );
}
