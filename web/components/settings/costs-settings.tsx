"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type StageCost = {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
};

type WikiRun = {
  run_id: string;
  generated_at: string;
  finished_at: string;
  model_id: string;
  draft_model_id?: string;
  wiki_candidates?: number;
  page_count: number;
  source_doc_count: number;
  drift_count?: number;
  pricing_source?: "table" | "env" | "partial" | "unknown";
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number | null;
  stages: Record<string, StageCost>;
};

type BrainOption = { brain_id: string; display_name: string };

// Friendly labels for the pipeline stages the generator records.
const STAGE_LABELS: Record<string, string> = {
  structure: "Structure",
  draft: "Drafts",
  page: "Pages (single-source)",
  judge: "Judge",
  cross_page: "Cross-page",
  other: "Other",
};

// Stable display order; unknown stages fall to the end.
const STAGE_ORDER = ["structure", "draft", "page", "judge", "cross_page", "other"];

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function formatUsd(value: number | null): string {
  if (value === null || value === undefined) return "—";
  // Sub-cent runs still want a meaningful figure.
  return value < 1 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

function formatTokens(n: number): string {
  return new Intl.NumberFormat().format(n);
}

function orderedStages(stages: Record<string, StageCost>): [string, StageCost][] {
  return Object.entries(stages).sort(
    (a, b) =>
      (STAGE_ORDER.indexOf(a[0]) + 1 || 99) -
      (STAGE_ORDER.indexOf(b[0]) + 1 || 99)
  );
}

function PricingCaveat({ source }: { source?: WikiRun["pricing_source"] }) {
  if (!source || source === "table") return null;
  const msg =
    source === "env"
      ? "estimate uses your configured rate override"
      : source === "partial"
        ? "estimate excludes one or more models with no known rate"
        : "no known rate for this model — tokens only";
  return <span className="ml-2 text-[11px] text-muted-foreground">({msg})</span>;
}

function RunRow({ run }: { run: WikiRun }) {
  const [open, setOpen] = React.useState(false);
  const stages = orderedStages(run.stages ?? {});

  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {formatTimestamp(run.generated_at)}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {run.page_count} page{run.page_count === 1 ? "" : "s"} ·{" "}
            {run.source_doc_count} source
            {run.source_doc_count === 1 ? "" : "s"}
            {run.drift_count ? ` · ${run.drift_count} drift` : ""}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-semibold tabular-nums">
            {formatUsd(run.total_cost_usd)}
            <PricingCaveat source={run.pricing_source} />
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {formatTokens(run.total_input_tokens + run.total_output_tokens)}{" "}
            tokens
          </div>
        </div>
      </button>

      {open ? (
        <div className="bg-muted/30 px-4 pb-4 pt-1">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 font-medium">Stage</th>
                <th className="py-1 text-right font-medium">Calls</th>
                <th className="py-1 text-right font-medium">In</th>
                <th className="py-1 text-right font-medium">Out</th>
                <th className="py-1 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {stages.map(([stage, s]) => (
                <tr key={stage} className="border-t border-border/40">
                  <td className="py-1">{STAGE_LABELS[stage] ?? stage}</td>
                  <td className="py-1 text-right tabular-nums">{s.calls}</td>
                  <td className="py-1 text-right tabular-nums">
                    {formatTokens(s.input_tokens)}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {formatTokens(s.output_tokens)}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {formatUsd(s.cost_usd)}
                  </td>
                </tr>
              ))}
              <tr className="border-t font-medium">
                <td className="py-1">Total</td>
                <td className="py-1 text-right tabular-nums">
                  {stages.reduce((n, [, s]) => n + s.calls, 0)}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {formatTokens(run.total_input_tokens)}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {formatTokens(run.total_output_tokens)}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {formatUsd(run.total_cost_usd)}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Model {run.model_id}
            {run.draft_model_id && run.draft_model_id !== run.model_id
              ? ` · drafts on ${run.draft_model_id}`
              : ""}
            {run.wiki_candidates
              ? ` · ${run.wiki_candidates} candidate${run.wiki_candidates === 1 ? "" : "s"}/page`
              : ""}
            . Token counts are exact; dollar figures are estimates from a rate
            table, not billed actuals.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function CostsSettings() {
  const [brains, setBrains] = React.useState<BrainOption[] | null>(null);
  const [brainId, setBrainId] = React.useState<string>("");
  const [runs, setRuns] = React.useState<WikiRun[] | null>(null);
  const [loading, setLoading] = React.useState(false);

  // Load the org's ready brains for the picker (same pattern as the model tab).
  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/brains/list?status=ready", {
          cache: "no-store",
        });
        const data = await res.json();
        const items = (data?.items ?? []) as BrainOption[];
        setBrains(items);
        if (items.length > 0) setBrainId(items[0].brain_id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        setBrains([]);
      }
    })();
  }, []);

  const loadRuns = React.useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/wiki/runs?brain=${encodeURIComponent(id)}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setRuns((data.runs ?? []) as WikiRun[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (brainId) loadRuns(brainId);
  }, [brainId, loadRuns]);

  if (brains === null) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (brains.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          No ready brains yet. Generate a wiki first, then per-run costs show up
          here.
        </CardContent>
      </Card>
    );
  }

  const grandTotal = (runs ?? []).reduce(
    (n, r) => n + (r.total_cost_usd ?? 0),
    0
  );

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Brain</label>
        <select
          value={brainId}
          onChange={(e) => setBrainId(e.target.value)}
          className="h-9 w-full max-w-sm rounded-lg border bg-background px-2 text-sm"
        >
          {brains.map((b) => (
            <option key={b.brain_id} value={b.brain_id}>
              {b.display_name}
            </option>
          ))}
        </select>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-6">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : !runs || runs.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No generation runs recorded yet for this brain. The next wiki
              regeneration will record its per-stage cost here.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground">
                <span>
                  {runs.length} run{runs.length === 1 ? "" : "s"}
                </span>
                <span className="tabular-nums">
                  {formatUsd(grandTotal)} total (est.)
                </span>
              </div>
              <div>
                {runs.map((run) => (
                  <RunRow key={run.run_id} run={run} />
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
