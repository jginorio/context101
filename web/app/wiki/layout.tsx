import * as React from "react";
import { redirect } from "next/navigation";

import { AppShellSkeleton } from "@/components/app-shell-skeleton";
import { requireActiveOrg } from "@/lib/auth/require-org";
import { WIKI_UI_ENABLED } from "@/lib/wiki-ui";

async function OrgGate({ children }: { children: React.ReactNode }) {
  await requireActiveOrg();
  return <>{children}</>;
}

export default function Layout({ children }: { children: React.ReactNode }) {
  if (!WIKI_UI_ENABLED) {
    redirect("/knowledge");
  }
  // Sync layout renders the boundary immediately; the async auth gate sits
  // INSIDE it, so navigation shows the skeleton instantly while
  // requireActiveOrg() resolves on the server (instead of a blank stall).
  return (
    <React.Suspense fallback={<AppShellSkeleton />}>
      <OrgGate>{children}</OrgGate>
    </React.Suspense>
  );
}
