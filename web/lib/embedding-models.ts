/**
 * Embedding model support — provider/dimension metadata and validation for a
 * brain's embedding configuration.
 *
 * The list of selectable models is loaded *dynamically* from Bedrock
 * (ListFoundationModels, output modality = EMBEDDING) by
 * `/api/settings/embeddings/models`, mirroring how the wiki-model picker lists
 * Bedrock text models. That avoids a hardcoded catalog drifting out of date
 * (e.g. missing Cohere Embed v4). This module provides the pieces that can't
 * come from that API:
 *
 *   - per-model vector dimensions (the ListFoundationModels response doesn't
 *     include them, but the S3 Vectors index needs an exact dimension), via a
 *     known-dimensions lookup with a sensible fallback;
 *   - provider inference from a model id;
 *   - the Cohere-only chunking strategy options + validation;
 *   - lenient server-side validation that resolves a selection to the concrete
 *     values the provisioner consumes.
 *
 * A brain's embedding model and vector dimension are baked into its Bedrock
 * Knowledge Base + S3 Vectors index at creation time and can't be changed in
 * place, so changing embeddings provisions a *replacement* brain.
 */

export type EmbeddingProvider = "aws" | "cohere";

export const DEFAULT_EMBEDDING_MODEL_ID = "amazon.titan-embed-text-v2:0";
export const DEFAULT_EMBEDDING_DIMENSION = 1024;

// Per-model vector dimensions. ListFoundationModels doesn't return these, so
// we keep an explicit lookup for the embedding models we know about. Unknown
// models fall back to a single 1024-dim option (the most common default).
export const KNOWN_EMBEDDING_DIMENSIONS: Record<
  string,
  { supportedDimensions: number[]; defaultDimension: number }
> = {
  "amazon.titan-embed-text-v2:0": {
    supportedDimensions: [256, 512, 1024],
    defaultDimension: 1024,
  },
  "amazon.titan-embed-text-v1": {
    supportedDimensions: [1536],
    defaultDimension: 1536,
  },
  "amazon.titan-embed-image-v1": {
    supportedDimensions: [256, 384, 1024],
    defaultDimension: 1024,
  },
  "cohere.embed-english-v3": {
    supportedDimensions: [1024],
    defaultDimension: 1024,
  },
  "cohere.embed-multilingual-v3": {
    supportedDimensions: [1024],
    defaultDimension: 1024,
  },
  "cohere.embed-english-light-v3": {
    supportedDimensions: [384],
    defaultDimension: 384,
  },
  "cohere.embed-multilingual-light-v3": {
    supportedDimensions: [384],
    defaultDimension: 384,
  },
  "cohere.embed-v4:0": {
    supportedDimensions: [256, 512, 1024, 1536],
    defaultDimension: 1024,
  },
};

const FALLBACK_DIMENSIONS = { supportedDimensions: [1024], defaultDimension: 1024 };

/** Static fallback list used by the models API when the Bedrock call fails. */
export const FALLBACK_EMBEDDING_MODELS: {
  id: string;
  provider: EmbeddingProvider;
  label: string;
}[] = [
  { id: "amazon.titan-embed-text-v2:0", provider: "aws", label: "Titan Text Embeddings V2" },
  { id: "amazon.titan-embed-text-v1", provider: "aws", label: "Titan Embeddings G1 - Text" },
  { id: "amazon.titan-embed-image-v1", provider: "aws", label: "Titan Multimodal Embeddings G1" },
  { id: "cohere.embed-v4:0", provider: "cohere", label: "Cohere Embed v4" },
  { id: "cohere.embed-english-v3", provider: "cohere", label: "Cohere Embed English v3" },
  { id: "cohere.embed-multilingual-v3", provider: "cohere", label: "Cohere Embed Multilingual v3" },
];

// Bedrock's ListFoundationModels returns the same generic `modelName` for
// distinct ids (e.g. "Embed English" for both cohere.embed-english-v3 and
// cohere.embed-english-light-v3), which makes the dropdown show duplicates.
// Prefer these explicit, unique labels keyed by model id.
export const EMBEDDING_MODEL_LABELS: Record<string, string> = {
  "amazon.titan-embed-text-v2:0": "Titan Text Embeddings V2",
  "amazon.titan-embed-text-v1": "Titan Embeddings G1 - Text",
  "amazon.titan-embed-image-v1": "Titan Multimodal Embeddings G1",
  "cohere.embed-english-v3": "Embed English v3",
  "cohere.embed-english-light-v3": "Embed English Light v3",
  "cohere.embed-multilingual-v3": "Embed Multilingual v3",
  "cohere.embed-multilingual-light-v3": "Embed Multilingual Light v3",
  "cohere.embed-v4:0": "Embed v4",
};

/**
 * A clear, unique display label for an embedding model. Uses the curated map
 * when known, otherwise derives a readable, unique label from the model id
 * (the modelName from Bedrock collides across variants, so we don't trust it).
 */
export function embeddingModelLabel(modelId: string): string {
  const known = EMBEDDING_MODEL_LABELS[modelId];
  if (known) return known;
  const core = modelId.split(".").slice(1).join(".").replace(/:.*$/, "");
  const pretty = core
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) =>
      /^v\d+$/i.test(w)
        ? w.toLowerCase()
        : w.charAt(0).toUpperCase() + w.slice(1)
    )
    .join(" ");
  return pretty || modelId;
}

/** Infer the provider bucket from a Bedrock embedding model id. */
export function inferEmbeddingProvider(modelId: string): EmbeddingProvider | null {
  if (modelId.startsWith("amazon.") || modelId.startsWith("amazon-")) return "aws";
  if (modelId.startsWith("cohere.")) return "cohere";
  return null;
}

export function knownDimensionsFor(modelId: string): {
  supportedDimensions: number[];
  defaultDimension: number;
} {
  return KNOWN_EMBEDDING_DIMENSIONS[modelId] ?? FALLBACK_DIMENSIONS;
}

/** Build the on-demand foundation-model ARN for an embedding model id. */
export function embeddingModelArn(modelId: string, region: string): string {
  return `arn:aws:bedrock:${region}::foundation-model/${modelId}`;
}

// ── Text chunking (Cohere-only in the UI) ────────────────────────────────
//
// Bedrock applies a chunking strategy when ingesting a data source. We expose
// the strategy choice only when the embedding provider is Cohere, per product
// requirements. "default" means "send no vectorIngestionConfiguration" and let
// Bedrock apply its built-in ~300-token strategy.

export type ChunkingStrategy =
  | "default"
  | "fixed"
  | "semantic"
  | "hierarchical"
  | "none";

export type ChunkingConfig = {
  strategy: ChunkingStrategy;
  // FIXED_SIZE
  maxTokens?: number;
  overlapPercentage?: number;
  // SEMANTIC
  bufferSize?: number;
  breakpointPercentileThreshold?: number;
  // HIERARCHICAL
  parentMaxTokens?: number;
  childMaxTokens?: number;
  overlapTokens?: number;
};

export const CHUNKING_STRATEGY_LABELS: Record<ChunkingStrategy, string> = {
  default: "Default (Bedrock managed)",
  fixed: "Fixed size",
  semantic: "Semantic",
  hierarchical: "Hierarchical",
  none: "None (one chunk per document)",
};

export const DEFAULT_CHUNKING: ChunkingConfig = { strategy: "default" };

// Sensible starting points for each strategy's tunable parameters. These
// mirror the Bedrock console defaults closely enough for a first pass.
export const CHUNKING_DEFAULTS = {
  fixed: { maxTokens: 300, overlapPercentage: 20 },
  semantic: {
    maxTokens: 300,
    bufferSize: 0,
    breakpointPercentileThreshold: 95,
  },
  hierarchical: {
    parentMaxTokens: 1500,
    childMaxTokens: 300,
    overlapTokens: 60,
  },
} as const;

/**
 * Validate and normalize a raw chunking config from an API request. Chunking
 * controls are Cohere-only: for any non-Cohere provider this coerces to the
 * Bedrock default. Returns `{ ok: true, config }` or `{ ok: false, error }`.
 */
export function normalizeChunkingConfig(
  provider: EmbeddingProvider,
  raw: unknown
):
  | { ok: true; config: ChunkingConfig }
  | { ok: false; error: string } {
  if (provider !== "cohere") {
    return { ok: true, config: { ...DEFAULT_CHUNKING } };
  }
  if (raw == null) return { ok: true, config: { ...DEFAULT_CHUNKING } };
  if (typeof raw !== "object") {
    return { ok: false, error: "chunkingConfig must be an object" };
  }
  const obj = raw as Record<string, unknown>;
  const strategy = obj.strategy as ChunkingStrategy | undefined;
  const allowed: ChunkingStrategy[] = [
    "default",
    "fixed",
    "semantic",
    "hierarchical",
    "none",
  ];
  if (!strategy || !allowed.includes(strategy)) {
    return {
      ok: false,
      error: `chunking strategy must be one of ${allowed.join(", ")}`,
    };
  }

  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;

  if (strategy === "default" || strategy === "none") {
    return { ok: true, config: { strategy } };
  }

  if (strategy === "fixed") {
    const maxTokens = num(obj.maxTokens) ?? CHUNKING_DEFAULTS.fixed.maxTokens;
    const overlapPercentage =
      num(obj.overlapPercentage) ?? CHUNKING_DEFAULTS.fixed.overlapPercentage;
    if (maxTokens < 1) {
      return { ok: false, error: "maxTokens must be >= 1" };
    }
    if (overlapPercentage < 0 || overlapPercentage > 99) {
      return { ok: false, error: "overlapPercentage must be between 0 and 99" };
    }
    return { ok: true, config: { strategy, maxTokens, overlapPercentage } };
  }

  if (strategy === "semantic") {
    const maxTokens = num(obj.maxTokens) ?? CHUNKING_DEFAULTS.semantic.maxTokens;
    const bufferSize =
      num(obj.bufferSize) ?? CHUNKING_DEFAULTS.semantic.bufferSize;
    const breakpointPercentileThreshold =
      num(obj.breakpointPercentileThreshold) ??
      CHUNKING_DEFAULTS.semantic.breakpointPercentileThreshold;
    if (maxTokens < 1) {
      return { ok: false, error: "maxTokens must be >= 1" };
    }
    if (bufferSize < 0 || bufferSize > 1) {
      return { ok: false, error: "bufferSize must be 0 or 1" };
    }
    if (
      breakpointPercentileThreshold < 50 ||
      breakpointPercentileThreshold > 99
    ) {
      return {
        ok: false,
        error: "breakpointPercentileThreshold must be between 50 and 99",
      };
    }
    return {
      ok: true,
      config: {
        strategy,
        maxTokens,
        bufferSize,
        breakpointPercentileThreshold,
      },
    };
  }

  // hierarchical
  const parentMaxTokens =
    num(obj.parentMaxTokens) ?? CHUNKING_DEFAULTS.hierarchical.parentMaxTokens;
  const childMaxTokens =
    num(obj.childMaxTokens) ?? CHUNKING_DEFAULTS.hierarchical.childMaxTokens;
  const overlapTokens =
    num(obj.overlapTokens) ?? CHUNKING_DEFAULTS.hierarchical.overlapTokens;
  if (childMaxTokens < 1 || parentMaxTokens < 1) {
    return { ok: false, error: "chunk token sizes must be >= 1" };
  }
  if (childMaxTokens >= parentMaxTokens) {
    return {
      ok: false,
      error: "childMaxTokens must be smaller than parentMaxTokens",
    };
  }
  if (overlapTokens < 0) {
    return { ok: false, error: "overlapTokens must be >= 0" };
  }
  return {
    ok: true,
    config: { strategy, parentMaxTokens, childMaxTokens, overlapTokens },
  };
}

export type ResolvedEmbeddingSelection = {
  provider: EmbeddingProvider;
  modelId: string;
  modelArn: string;
  dimensions: number;
  chunking: ChunkingConfig;
};

/**
 * Validate a raw embedding selection (provider + model id + optional
 * dimensions + chunking) and resolve it to concrete values the provisioner
 * consumes. Validation is intentionally lenient about the model id itself —
 * the selectable list is sourced live from Bedrock, so we don't gate on a
 * static catalog (mirroring the wiki-model route). We do require the provider
 * to match the model id's prefix, and dimensions to match the known set when
 * the model is one we have metadata for.
 */
export function resolveEmbeddingSelection(
  input: {
    provider?: unknown;
    modelId?: unknown;
    dimensions?: unknown;
    chunkingConfig?: unknown;
  },
  region: string
):
  | { ok: true; selection: ResolvedEmbeddingSelection }
  | { ok: false; error: string } {
  const provider = input.provider as EmbeddingProvider | undefined;
  if (provider !== "aws" && provider !== "cohere") {
    return { ok: false, error: "provider must be 'aws' or 'cohere'" };
  }
  const modelId = typeof input.modelId === "string" ? input.modelId.trim() : "";
  if (!modelId) {
    return { ok: false, error: "modelId is required" };
  }
  const inferred = inferEmbeddingProvider(modelId);
  if (inferred && inferred !== provider) {
    return {
      ok: false,
      error: `modelId '${modelId}' does not match provider '${provider}'`,
    };
  }

  const known = KNOWN_EMBEDDING_DIMENSIONS[modelId];
  let dimensions = known?.defaultDimension ?? DEFAULT_EMBEDDING_DIMENSION;
  if (input.dimensions != null) {
    const d =
      typeof input.dimensions === "number"
        ? input.dimensions
        : Number(input.dimensions);
    if (!Number.isInteger(d) || d < 1) {
      return { ok: false, error: "dimensions must be a positive integer" };
    }
    if (known && !known.supportedDimensions.includes(d)) {
      return {
        ok: false,
        error: `dimensions must be one of ${known.supportedDimensions.join(", ")} for ${modelId}`,
      };
    }
    dimensions = d;
  }

  const chunk = normalizeChunkingConfig(provider, input.chunkingConfig);
  if (!chunk.ok) return { ok: false, error: chunk.error };

  return {
    ok: true,
    selection: {
      provider,
      modelId,
      modelArn: embeddingModelArn(modelId, region),
      dimensions,
      chunking: chunk.config,
    },
  };
}
