import * as React from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { organization } from "@/lib/db/auth-schema";
import { LoginForm } from "@/components/login-form";
import { LoginShell } from "@/components/login-shell";

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
    <LoginShell>
      <LoginForm setupAvailable={setupAvailable} />
    </LoginShell>
  );
}

export default function LoginPage() {
  return (
    <React.Suspense fallback={null}>
      <LoginContent />
    </React.Suspense>
  );
}
