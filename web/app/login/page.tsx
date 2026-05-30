import * as React from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { organization } from "@/lib/db/auth-schema";
import { LoginForm } from "@/components/login-form";

async function hasAnyOrganization() {
  if (!db) return false;
  const rows = await db.select({ id: organization.id }).from(organization).limit(1);
  return rows.length > 0;
}

async function LoginContent() {
  const session = await getAuth()
    .api.getSession({
      headers: await headers(),
    })
    .catch(() => null);
  if (session) redirect("/knowledge");

  const setupAvailable = !(await hasAnyOrganization());

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 sm:p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Context101</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to manage the team knowledge base
          </p>
        </div>
        <LoginForm setupAvailable={setupAvailable} />
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <React.Suspense fallback={null}>
      <LoginContent />
    </React.Suspense>
  );
}
