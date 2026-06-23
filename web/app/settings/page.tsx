"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Boxes,
  DollarSign,
  FileText,
  KeyRound,
  Plug,
  Settings as SettingsIcon,
  Users,
} from "lucide-react";

import { SignOutButton } from "@/components/sign-out-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OrganizationSettings } from "@/components/settings/organization-settings";
import { WikiModelSettings } from "@/components/settings/wiki-model-settings";
import { EmbeddingSettings } from "@/components/settings/embedding-settings";

type SectionId =
  | "organization"
  | "model"
  | "embeddings"
  | "wiki"
  | "sources"
  | "costs"
  | "analytics";

type Section = {
  id: SectionId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  available: boolean;
};

const SECTIONS: Section[] = [
  { id: "organization", label: "Organization", icon: Users, available: true },
  { id: "model", label: "Wiki model & API keys", icon: KeyRound, available: true },
  { id: "embeddings", label: "Embeddings", icon: Boxes, available: true },
  { id: "wiki", label: "Wiki regeneration", icon: FileText, available: false },
  { id: "sources", label: "Source sync", icon: Plug, available: false },
  { id: "costs", label: "Costs", icon: DollarSign, available: false },
  { id: "analytics", label: "Analytics", icon: BarChart3, available: false },
];

export default function SettingsPage() {
  const [active, setActive] = React.useState<SectionId>("organization");
  const current = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

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
                    onClick={() => s.available && setActive(s.id)}
                    disabled={!s.available}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors whitespace-nowrap",
                      isActive
                        ? "bg-muted font-medium"
                        : "text-muted-foreground hover:bg-muted/60",
                      !s.available && "cursor-not-allowed opacity-50 hover:bg-transparent"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{s.label}</span>
                    {!s.available ? (
                      <span className="hidden rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground md:inline">
                        soon
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <section className="min-w-0 flex-1">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">{current.label}</h2>
            {active === "organization" ? (
              <p className="text-sm text-muted-foreground">
                Manage who has access to this organization and their roles.
              </p>
            ) : active === "model" ? (
              <p className="text-sm text-muted-foreground">
                Choose which model generates each brain&apos;s wiki — AWS
                Bedrock, or bring your own Anthropic / OpenAI / Grok / Gemini
                key.
              </p>
            ) : active === "embeddings" ? (
              <p className="text-sm text-muted-foreground">
                Choose the embedding model a brain uses — AWS Titan or Cohere
                (via Bedrock) — and, for Cohere, its text chunking strategy.
              </p>
            ) : null}
          </div>

          {active === "organization" ? <OrganizationSettings /> : null}
          {active === "model" ? <WikiModelSettings /> : null}
          {active === "embeddings" ? <EmbeddingSettings /> : null}
        </section>
      </div>
    </main>
  );
}
