"use client";

import { SignOutButton } from "@/components/sign-out-button";
import { OrgChooser } from "@/components/org-chooser";
import { buttonVariants } from "@/components/ui/button";

export function RenewScreen({
  orgName,
  renewUrl,
  orgs,
  activeOrgId,
}: {
  orgName: string;
  renewUrl: string;
  orgs: {
    id: string;
    name: string;
    slug: string;
    logo: string | null;
    role: string;
    softLocked?: boolean;
  }[];
  activeOrgId: string;
}) {
  const canSwitch = orgs.length > 0;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Subscription ended
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">{orgName}</span>{" "}
            cannot be used until you renew. Your files and members are still
            here.
          </p>
        </div>

        <div className="flex flex-col items-center gap-3">
          <a href={renewUrl} className={buttonVariants({ size: "lg" })}>
            Renew
          </a>
          <SignOutButton next="/knowledge" />
        </div>

        {canSwitch ? (
          <div className="mt-10">
            <h2 className="mb-4 text-center text-sm font-medium">
              Switch organization
            </h2>
            <p className="mb-4 text-center text-sm text-muted-foreground">
              You can still open another organization you belong to.
            </p>
            <OrgChooser
              orgs={orgs}
              activeOrgId={activeOrgId}
              next="/knowledge"
              allowCreate={false}
            />
          </div>
        ) : null}
      </div>
    </main>
  );
}
