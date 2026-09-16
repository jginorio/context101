import * as React from "react";
import { redirect } from "next/navigation";

import { AppShellSkeleton } from "@/components/app-shell-skeleton";
import { requireActiveOrg } from "@/lib/auth/require-org";

async function OrgGate({ children }: { children: React.ReactNode }) {
  await requireActiveOrg();
  return <>{children}</>;
}

export default function Layout({ children }: { children: React.ReactNode }) {
  // Conflicts chrome is parked on main. Isolated restore removes this redirect.
  redirect("/knowledge");
  return (
    <React.Suspense fallback={<AppShellSkeleton />}>
      <OrgGate>{children}</OrgGate>
    </React.Suspense>
  );
}
