"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertCircle,
  BookOpen,
  Brain,
  CheckCircle2,
  Loader2,
  MessagesSquare,
} from "lucide-react";

import { useBrain } from "@/lib/brain-context";

/**
 * Fills the otherwise-empty sidebar space on pages that don't supply a context
 * panel (Brains, Sources, Suggestions, Ask). Gives the user at-a-glance
 * orientation for the active brain — name, status, embedding model, a short
 * description — plus the most common cross-brain actions.
 */
export function SidebarBrainPanel({ onNavigate }: { onNavigate?: () => void }) {
  const { currentBrain, currentBrainId, loading } = useBrain();
  const [model, setModel] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!currentBrainId) return;
    let cancelled = false;
    setModel(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/settings/embeddings?brain=${encodeURIComponent(currentBrainId)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const d = await res.json();
        if (!cancelled) setModel(d.model_label ?? d.model_id ?? null);
      } catch {
        // best-effort — the panel still works without the model line
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentBrainId]);

  const name = currentBrain?.display_name ?? currentBrainId ?? "—";
  const status = currentBrain?.status;

  const statusBadge =
    status === "ready" ? (
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
    ) : status === "provisioning" || status === "deleting" ? (
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-600 dark:text-amber-400" />
    ) : status === "error" ? (
      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
    ) : null;

  const actionClass =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground";

  return (
    <div className="space-y-3 p-2">
      <div className="px-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Current brain
        </p>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {name}
          </span>
          {statusBadge}
        </div>
        {currentBrain?.description ? (
          <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
            {currentBrain.description}
          </p>
        ) : null}
        {model ? (
          <p className="mt-2 truncate text-[11px] text-muted-foreground">
            Embeddings:{" "}
            <span className="font-medium text-foreground">{model}</span>
          </p>
        ) : loading && !currentBrain ? (
          <p className="mt-2 text-[11px] text-muted-foreground">Loading…</p>
        ) : null}
      </div>

      <div className="space-y-0.5 border-t border-sidebar-border/60 pt-2">
        <Link href="/wiki/ask" onClick={onNavigate} className={actionClass}>
          <MessagesSquare className="h-4 w-4 shrink-0" /> Ask the brain
        </Link>
        <Link href="/wiki" onClick={onNavigate} className={actionClass}>
          <BookOpen className="h-4 w-4 shrink-0" /> Go to wiki
        </Link>
        <Link href="/brains" onClick={onNavigate} className={actionClass}>
          <Brain className="h-4 w-4 shrink-0" /> Manage brains
        </Link>
      </div>
    </div>
  );
}
