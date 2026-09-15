"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { BrainStatusGate } from "@/components/brain-status-gate";
import { Button } from "@/components/ui/button";
import { useBrain } from "@/lib/brain-context";
import { WikiModelSettings } from "../wiki-model-settings";

export default function WikiSettingsPage() {
  const { currentBrainId } = useBrain();

  return (
    <AppShell
      title="Wiki settings"
      subtitle="Model and API keys for wiki generation"
      toolbar={
        <Link href="/wiki">
          <Button variant="outline" size="sm">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back to wiki
          </Button>
        </Link>
      }
    >
      <BrainStatusGate>
        <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-2xl">
            <p className="mb-4 text-sm text-muted-foreground">
              Choose which model generates this brain&apos;s wiki — AWS
              Bedrock, or bring your own Anthropic / OpenAI / Grok / Gemini
              key.
            </p>
            <WikiModelSettings initialBrainId={currentBrainId ?? undefined} />
          </div>
        </div>
      </BrainStatusGate>
    </AppShell>
  );
}
