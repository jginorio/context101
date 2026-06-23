"use client";

import * as React from "react";
import { toast } from "sonner";

import {
  CHUNKING_DEFAULTS,
  CHUNKING_STRATEGY_LABELS,
  DEFAULT_CHUNKING,
  DEFAULT_EMBEDDING_DIMENSION,
  DEFAULT_EMBEDDING_MODEL_ID,
  type ChunkingConfig,
  type ChunkingStrategy,
  type EmbeddingProvider,
} from "@/lib/embedding-models";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

export type EmbeddingSelection = {
  provider: EmbeddingProvider;
  modelId: string;
  dimensions: number;
  chunking: ChunkingConfig;
};

type CatalogModel = {
  id: string;
  provider: EmbeddingProvider;
  label: string;
  supported_dimensions: number[];
  default_dimension: number;
};

const PROVIDER_LABELS: Record<EmbeddingProvider, string> = {
  aws: "AWS (Amazon Titan)",
  cohere: "Cohere",
};

/** A sensible default selection for a freshly created brain. */
export function defaultEmbeddingSelection(): EmbeddingSelection {
  return {
    provider: "aws",
    modelId: DEFAULT_EMBEDDING_MODEL_ID,
    dimensions: DEFAULT_EMBEDDING_DIMENSION,
    chunking: { ...DEFAULT_CHUNKING },
  };
}

const selectClass =
  "h-9 w-full rounded-lg border bg-background px-2 text-sm disabled:opacity-50";

export function EmbeddingControls({
  value,
  onChange,
  disabled,
}: {
  value: EmbeddingSelection;
  onChange: (next: EmbeddingSelection) => void;
  disabled?: boolean;
}) {
  const [catalog, setCatalog] = React.useState<CatalogModel[] | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/embeddings/models", {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
        if (cancelled) return;
        setCatalog((data.models ?? []) as CatalogModel[]);
        setWarning(data.warning ?? null);
      } catch (err) {
        if (cancelled) return;
        setCatalog([]);
        const msg = err instanceof Error ? err.message : String(err);
        setWarning(msg);
        toast.error(`Couldn't load embedding models: ${msg}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const providers = React.useMemo<EmbeddingProvider[]>(() => {
    const set = new Set<EmbeddingProvider>();
    for (const m of catalog ?? []) set.add(m.provider);
    if (set.size === 0) {
      set.add("aws");
      set.add("cohere");
    }
    return [...set];
  }, [catalog]);

  const modelsForProvider = React.useMemo(
    () => (catalog ?? []).filter((m) => m.provider === value.provider),
    [catalog, value.provider]
  );

  // Make sure the currently-selected model is always selectable, even if it's
  // not in the live list (e.g. a legacy brain's model). Inject a synthetic
  // entry so the <select> can show it.
  const visibleModels = React.useMemo(() => {
    const list = [...modelsForProvider];
    if (value.modelId && !list.some((m) => m.id === value.modelId)) {
      list.unshift({
        id: value.modelId,
        provider: value.provider,
        label: value.modelId,
        supported_dimensions: [value.dimensions],
        default_dimension: value.dimensions,
      });
    }
    return list;
  }, [modelsForProvider, value.modelId, value.provider, value.dimensions]);

  const selectedModel = visibleModels.find((m) => m.id === value.modelId);

  // Once the catalog loads, if the selected model isn't valid for the chosen
  // provider, snap to the first available model for that provider.
  const reconciled = React.useRef(false);
  React.useEffect(() => {
    if (!catalog || reconciled.current) return;
    if (modelsForProvider.length === 0) return;
    if (!modelsForProvider.some((m) => m.id === value.modelId)) {
      reconciled.current = true;
      const first = modelsForProvider[0];
      onChange({
        provider: value.provider,
        modelId: first.id,
        dimensions: first.default_dimension,
        chunking:
          value.provider === "cohere" ? value.chunking : { ...DEFAULT_CHUNKING },
      });
    } else {
      reconciled.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  function pickProvider(provider: EmbeddingProvider) {
    const first = (catalog ?? []).find((m) => m.provider === provider);
    onChange({
      provider,
      modelId: first?.id ?? "",
      dimensions: first?.default_dimension ?? DEFAULT_EMBEDDING_DIMENSION,
      chunking: provider === "cohere" ? value.chunking : { ...DEFAULT_CHUNKING },
    });
  }

  function pickModel(modelId: string) {
    const model = visibleModels.find((m) => m.id === modelId);
    onChange({
      ...value,
      modelId,
      dimensions: model?.default_dimension ?? value.dimensions,
    });
  }

  const isCohere = value.provider === "cohere";
  const strategy = value.chunking.strategy;

  function setStrategy(next: ChunkingStrategy) {
    let chunking: ChunkingConfig = { strategy: next };
    if (next === "fixed") chunking = { strategy: next, ...CHUNKING_DEFAULTS.fixed };
    else if (next === "semantic")
      chunking = { strategy: next, ...CHUNKING_DEFAULTS.semantic };
    else if (next === "hierarchical")
      chunking = { strategy: next, ...CHUNKING_DEFAULTS.hierarchical };
    onChange({ ...value, chunking });
  }

  function setChunkParam(key: keyof ChunkingConfig, raw: string) {
    const n = Number(raw);
    onChange({
      ...value,
      chunking: { ...value.chunking, [key]: Number.isFinite(n) ? n : undefined },
    });
  }

  if (catalog === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-2/3" />
      </div>
    );
  }

  const dimensionOptions = selectedModel?.supported_dimensions ?? [
    value.dimensions,
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Embedding provider</label>
        <select
          value={value.provider}
          disabled={disabled}
          onChange={(e) => pickProvider(e.target.value as EmbeddingProvider)}
          className={selectClass}
        >
          {providers.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABELS[p]}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Embedding model</label>
        <select
          value={value.modelId}
          disabled={disabled || visibleModels.length === 0}
          onChange={(e) => pickModel(e.target.value)}
          className={selectClass}
        >
          {visibleModels.length === 0 ? (
            <option value="">No models available</option>
          ) : (
            visibleModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))
          )}
        </select>
        {warning ? (
          <p className="text-xs text-amber-600 dark:text-amber-400">{warning}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Models are listed live from AWS Bedrock.
          </p>
        )}
      </div>

      {dimensionOptions.length > 1 ? (
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Vector dimensions</label>
          <select
            value={value.dimensions}
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...value, dimensions: Number(e.target.value) })
            }
            className={selectClass}
          >
            {dimensionOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Vector dimensions: {value.dimensions}
        </p>
      )}

      {isCohere ? (
        <div className="space-y-3 rounded-md border bg-muted/20 p-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Text chunking strategy</label>
            <select
              value={strategy}
              disabled={disabled}
              onChange={(e) => setStrategy(e.target.value as ChunkingStrategy)}
              className={selectClass}
            >
              {(
                Object.keys(CHUNKING_STRATEGY_LABELS) as ChunkingStrategy[]
              ).map((s) => (
                <option key={s} value={s}>
                  {CHUNKING_STRATEGY_LABELS[s]}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              How documents are split before embedding. Only configurable for
              Cohere models.
            </p>
          </div>

          {strategy === "fixed" ? (
            <div className="grid grid-cols-2 gap-3">
              <ChunkField
                label="Max tokens"
                value={value.chunking.maxTokens}
                disabled={disabled}
                onChange={(v) => setChunkParam("maxTokens", v)}
              />
              <ChunkField
                label="Overlap %"
                value={value.chunking.overlapPercentage}
                disabled={disabled}
                onChange={(v) => setChunkParam("overlapPercentage", v)}
              />
            </div>
          ) : null}

          {strategy === "semantic" ? (
            <div className="grid grid-cols-3 gap-3">
              <ChunkField
                label="Max tokens"
                value={value.chunking.maxTokens}
                disabled={disabled}
                onChange={(v) => setChunkParam("maxTokens", v)}
              />
              <ChunkField
                label="Buffer size"
                value={value.chunking.bufferSize}
                disabled={disabled}
                onChange={(v) => setChunkParam("bufferSize", v)}
              />
              <ChunkField
                label="Breakpoint %"
                value={value.chunking.breakpointPercentileThreshold}
                disabled={disabled}
                onChange={(v) =>
                  setChunkParam("breakpointPercentileThreshold", v)
                }
              />
            </div>
          ) : null}

          {strategy === "hierarchical" ? (
            <div className="grid grid-cols-3 gap-3">
              <ChunkField
                label="Parent tokens"
                value={value.chunking.parentMaxTokens}
                disabled={disabled}
                onChange={(v) => setChunkParam("parentMaxTokens", v)}
              />
              <ChunkField
                label="Child tokens"
                value={value.chunking.childMaxTokens}
                disabled={disabled}
                onChange={(v) => setChunkParam("childMaxTokens", v)}
              />
              <ChunkField
                label="Overlap tokens"
                value={value.chunking.overlapTokens}
                disabled={disabled}
                onChange={(v) => setChunkParam("overlapTokens", v)}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ChunkField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number | undefined;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Input
        type="number"
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-8"
      />
    </div>
  );
}
