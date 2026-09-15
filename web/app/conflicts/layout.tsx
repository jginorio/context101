import * as React from "react";

import { AppShellSkeleton } from "@/components/app-shell-skeleton";
import { requireActiveOrg } from "@/lib/auth/require-org";

async function OrgGate({ children }: { children: React.ReactNode }) {
  await requireActiveOrg();
  return <>{children}</>;
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <React.Suspense fallback={<AppShellSkeleton />}>
      <OrgGate>{children}</OrgGate>
    </React.Suspense>
  );
}
