// Keep in sync with web/lib/embedding-models.ts — ListFoundationModels
// does not return vector dimensions, and SKU variants (…:0:512) are not
// valid Knowledge Base embeddingModelArn values.
export const KNOWN_EMBEDDING_DIMENSIONS = {
  "amazon.titan-embed-text-v2:0": {
    supportedDimensions: [256, 512, 1024],
    defaultDimension: 1024,
    label: "Titan Text Embeddings V2",
    provider: "aws",
  },
  "amazon.titan-embed-text-v1": {
    supportedDimensions: [1536],
    defaultDimension: 1536,
    label: "Titan Embeddings G1 - Text",
    provider: "aws",
  },
  "amazon.titan-embed-image-v1": {
    supportedDimensions: [1024],
    defaultDimension: 1024,
    label: "Titan Multimodal Embeddings G1",
    provider: "aws",
  },
  "cohere.embed-english-v3": {
    supportedDimensions: [1024],
    defaultDimension: 1024,
    label: "Embed English v3",
    provider: "cohere",
  },
  "cohere.embed-multilingual-v3": {
    supportedDimensions: [1024],
    defaultDimension: 1024,
    label: "Embed Multilingual v3",
    provider: "cohere",
  },
  "cohere.embed-english-light-v3": {
    supportedDimensions: [384],
    defaultDimension: 384,
    label: "Embed English Light v3",
    provider: "cohere",
  },
  "cohere.embed-multilingual-light-v3": {
    supportedDimensions: [384],
    defaultDimension: 384,
    label: "Embed Multilingual Light v3",
    provider: "cohere",
  },
};

export function isKnownEmbeddingModel(modelId) {
  return Boolean(modelId && KNOWN_EMBEDDING_DIMENSIONS[modelId]);
}

export function embeddingModelMeta(modelId) {
  return KNOWN_EMBEDDING_DIMENSIONS[modelId] ?? null;
}

export function fallbackEmbeddingModels() {
  return Object.keys(KNOWN_EMBEDDING_DIMENSIONS).map((id) => catalogEntry(id));
}

/** Live Bedrock list plus every curated embedding id brains can pick later. */
export function allEmbeddingModels(listed = []) {
  const byId = new Map();
  for (const id of Object.keys(KNOWN_EMBEDDING_DIMENSIONS)) {
    byId.set(id, catalogEntry(id));
  }
  for (const model of listed) {
    if (model?.id) byId.set(model.id, model);
  }
  return [...byId.values()].sort((a, b) =>
    a.provider === b.provider
      ? a.label.localeCompare(b.label)
      : a.provider.localeCompare(b.provider)
  );
}

export function catalogEntry(modelId) {
  const meta = KNOWN_EMBEDDING_DIMENSIONS[modelId];
  return {
    id: modelId,
    provider: meta.provider,
    label: meta.label,
    dimensions: meta.defaultDimension,
  };
}

export function formatEmbeddingChoice(model) {
  return `${model.label} (${model.id}, ${model.dimensions})`;
}

function providerFromName(name) {
  if (name === "Amazon") return "aws";
  if (name === "Cohere") return "cohere";
  return null;
}

export function parseEmbeddingCatalog(payload) {
  const summaries = payload?.modelSummaries;
  if (!Array.isArray(summaries)) return [];
  const seen = new Set();
  const models = [];
  for (const row of summaries) {
    const id = row?.modelId;
    if (!id || seen.has(id)) continue;
    if (row.modelLifecycle?.status && row.modelLifecycle.status !== "ACTIVE") {
      continue;
    }
    if (!KNOWN_EMBEDDING_DIMENSIONS[id]) continue;
    if (!providerFromName(row.providerName)) continue;
    seen.add(id);
    models.push(catalogEntry(id));
  }
  models.sort((a, b) =>
    a.provider === b.provider
      ? a.label.localeCompare(b.label)
      : a.provider.localeCompare(b.provider)
  );
  return models;
}

export function listEmbeddingModels({ exec, env, region } = {}) {
  if (!exec || !region) {
    return { models: fallbackEmbeddingModels(), source: "fallback", warning: null };
  }
  const result = exec({
    command: "aws",
    args: [
      "bedrock",
      "list-foundation-models",
      "--by-output-modality",
      "EMBEDDING",
      "--region",
      region,
      "--output",
      "json",
    ],
    env,
  });
  if (!result.ok) {
    return {
      models: fallbackEmbeddingModels(),
      source: "fallback",
      warning: "Could not list Bedrock embedding models — showing defaults.",
    };
  }
  try {
    const listed = parseEmbeddingCatalog(JSON.parse(result.stdout || "{}"));
    const models = allEmbeddingModels(listed);
    if (listed.length === 0) {
      return {
        models,
        source: "fallback",
        warning: "No embedding models returned by Bedrock — showing defaults.",
      };
    }
    return { models, source: "live", warning: null };
  } catch {
    return {
      models: fallbackEmbeddingModels(),
      source: "fallback",
      warning: "Could not list Bedrock embedding models — showing defaults.",
    };
  }
}
