"use client";

import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CHUNKING_STRATEGY_LABELS,
  type ChunkingConfig,
  type EmbeddingProvider,
} from "@/lib/embedding-models";
import {
  defaultEmbeddingSelection,
  EmbeddingControls,
  type EmbeddingSelection,
} from "@/components/settings/embedding-controls";

type BrainOption = { brain_id: string; display_name: string };

type CurrentConfig = {
  provider: EmbeddingProvider;
  model_id: string;
  model_label: string;
  dimensions: number;
  chunking: ChunkingConfig;
};

const strategyLabel = (s: ChunkingConfig["strategy"] | undefined) =>
  CHUNKING_STRATEGY_LABELS[s ?? "default"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function EmbeddingSettings() {
  const [brains, setBrains] = React.useState<BrainOption[] | null>(null);
  const [brainId, setBrainId] = React.useState("");
  const [current, setCurrent] = React.useState<CurrentConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [selection, setSelection] = React.useState<EmbeddingSelection>(
    defaultEmbeddingSelection()
  );

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

  const loadConfig = React.useCallback(async (id: string) => {
    if (!id) return;
    setLoadingConfig(true);
    try {
      const res = await fetch(
        `/api/settings/embeddings?brain=${encodeURIComponent(id)}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setCurrent(data as CurrentConfig);
      setSelection({
        provider: data.provider,
        modelId: data.model_id,
        dimensions: data.dimensions,
        chunking: data.chunking ?? { strategy: "default" },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setCurrent(null);
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  React.useEffect(() => {
    if (brainId) loadConfig(brainId);
  }, [brainId, loadConfig]);

  // Poll the brain's embedding config until it reflects the requested model —
  // the signal that the in-place re-embed has swapped the brain over. The
  // brain id never changes, so there's nothing to switch to.
  async function waitForEmbedding(
    id: string,
    sel: EmbeddingSelection
  ): Promise<boolean> {
    const deadline = Date.now() + 15 * 60 * 1000; // 15 min ceiling
    while (Date.now() < deadline) {
      await sleep(4000);
      try {
        const res = await fetch(
          `/api/settings/embeddings?brain=${encodeURIComponent(id)}`,
          { cache: "no-store" }
        );
        const d = await res.json().catch(() => ({}));
        if (
          res.ok &&
          d.model_id === sel.modelId &&
          d.dimensions === sel.dimensions &&
          (d.chunking?.strategy ?? "default") === sel.chunking.strategy
        ) {
          return true;
        }
      } catch {
        // transient — keep polling
      }
    }
    return false;
  }

  async function handleApply() {
    const id = brainId;
    const sel = selection;
    setApplying(true);
    try {
      const res = await fetch("/api/settings/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brainId: id,
          provider: sel.provider,
          modelId: sel.modelId,
          dimensions: sel.dimensions,
          chunkingConfig: sel.chunking,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);

      const done = await waitForEmbedding(id, sel);
      if (!done) {
        throw new Error(
          "Re-embedding is taking longer than expected — it will finish in the background. Refresh later to confirm."
        );
      }
      await loadConfig(id);
      toast.success("Embedding model updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }

  if (brains === null) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  if (brains.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          No ready brains yet. Create a brain first, then configure its
          embeddings here.
        </CardContent>
      </Card>
    );
  }

  const currentModel = current ? current.model_label : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Embedding model</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Brain</label>
            <select
              value={brainId}
              onChange={(e) => setBrainId(e.target.value)}
              disabled={applying}
              className="h-9 w-full rounded-lg border bg-background px-2 text-sm"
            >
              {brains.map((b) => (
                <option key={b.brain_id} value={b.brain_id}>
                  {b.display_name}
                </option>
              ))}
            </select>
          </div>

          {loadingConfig ? (
            <p className="text-xs text-muted-foreground">Loading current config…</p>
          ) : current ? (
            <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
              <p>
                Current:{" "}
                <span className="font-medium text-foreground">
                  {currentModel}
                </span>{" "}
                · {current.dimensions} dims · chunking{" "}
                {strategyLabel(current.chunking?.strategy)}
              </p>
            </div>
          ) : null}

          <EmbeddingControls
            value={selection}
            onChange={setSelection}
            disabled={applying || loadingConfig}
          />

          {applying ? (
            <div className="flex items-start gap-2 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
              <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
              <span>
                Updating the embedding model and re-embedding this brain&apos;s
                knowledge base. This can take a few minutes — you can keep
                working, just keep this tab open until it finishes.
              </span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Updating re-embeds the brain&apos;s knowledge base with the new
              model. This runs in the background and can take a few minutes.
            </p>
          )}

          <div className="flex items-center gap-3 pt-1">
            <Button
              type="button"
              onClick={handleApply}
              disabled={applying || loadingConfig}
            >
              {applying ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-1 h-3.5 w-3.5" />
              )}
              {applying ? "Updating…" : "Update embedding model"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
