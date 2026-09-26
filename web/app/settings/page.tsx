"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  FlaskConical,
  Settings as SettingsIcon,
  Users,
} from "lucide-react";

import { SignOutButton } from "@/components/sign-out-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OrganizationSettings } from "@/components/settings/organization-settings";
import { EmbeddingSettings } from "@/components/settings/embedding-settings";

type SectionId = "organization" | "advanced";

type Section = {
  id: SectionId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const SECTIONS: Section[] = [
  { id: "organization", label: "Organization", icon: Users },
  { id: "advanced", label: "Advanced", icon: FlaskConical },
];

function SettingsContent() {
  const searchParams = useSearchParams();
  const sectionParam = searchParams.get("section");
  // Lets the /brains "Advanced" button deep-link to a specific brain so its
  // embedding config is preselected when the page opens.
  const brainParam = searchParams.get("brain");

  const [active, setActive] = React.useState<SectionId>(
    sectionParam === "advanced" ? "advanced" : "organization"
  );

  return (
    <main className="flex min-h-screen flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Link href="/knowledge">
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex">
              <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="sm:hidden"
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <SettingsIcon className="h-4 w-4" />
            <h1 className="text-base font-semibold tracking-tight sm:text-lg">
              Settings
            </h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SignOutButton next="/settings" className="hidden sm:inline-flex" />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8 md:flex-row">
        <nav className="md:w-56 md:shrink-0">
          <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const isActive = s.id === active;
              return (
                <li key={s.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => setActive(s.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors whitespace-nowrap",
                      isActive
                        ? "bg-muted font-medium"
                        : "text-muted-foreground hover:bg-muted/60"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{s.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <section className="min-w-0 flex-1">
          {active === "organization" ? (
            <>
              <div className="mb-4">
                <h2 className="text-lg font-semibold">Organization</h2>
                <p className="text-sm text-muted-foreground">
                  Manage who has access to this organization and their roles.
                </p>
              </div>
              <OrganizationSettings />
            </>
          ) : null}

          {active === "advanced" ? (
            <>
              <div className="mb-4">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <FlaskConical className="h-4 w-4 text-muted-foreground" />
                  Advanced
                </h2>
                <p className="text-sm text-muted-foreground">
                  Per-brain embedding configuration — how each brain embeds
                  knowledge for search.
                </p>
              </div>

              <p className="mb-4 text-sm text-muted-foreground">
                Choose the embedding model a brain uses — AWS Titan or Cohere
                (via Bedrock) — and, for Cohere, its text chunking strategy.
              </p>
              <EmbeddingSettings initialBrainId={brainParam ?? undefined} />
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}

export default function SettingsPage() {
  // useSearchParams needs a Suspense boundary during prerender.
  return (
    <React.Suspense fallback={null}>
      <SettingsContent />
    </React.Suspense>
  );
}
