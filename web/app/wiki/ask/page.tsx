"use client";

import { AppShell } from "@/components/app-shell";
import { BrainStatusGate } from "@/components/brain-status-gate";
import { WikiChat } from "@/components/wiki-chat";

export default function WikiAskPage() {
  return (
    <AppShell
      title="Ask the brain"
      subtitle="Query the knowledge base and see exactly what it retrieves"
    >
      <BrainStatusGate>
        <div className="min-h-0 flex-1">
          <WikiChat />
        </div>
      </BrainStatusGate>
    </AppShell>
  );
}
