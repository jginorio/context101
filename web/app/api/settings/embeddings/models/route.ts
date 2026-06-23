import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  BedrockClient,
  ListFoundationModelsCommand,
} from "@aws-sdk/client-bedrock";

import { readAuthContext } from "@/lib/brains-server";
import {
  CHUNKING_DEFAULTS,
  CHUNKING_STRATEGY_LABELS,
  embeddingModelLabel,
  FALLBACK_EMBEDDING_MODELS,
  KNOWN_EMBEDDING_DIMENSIONS,
  knownDimensionsFor,
  type EmbeddingProvider,
} from "@/lib/embedding-models";

const region = process.env.AWS_REGION ?? "us-east-1";
const bedrock = new BedrockClient({ region });

type CatalogModel = {
  id: string;
  provider: EmbeddingProvider;
  label: string;
  supported_dimensions: number[];
  default_dimension: number;
};

function providerFromName(name: string | undefined): EmbeddingProvider | null {
  if (name === "Amazon") return "aws";
  if (name === "Cohere") return "cohere";
  return null;
}

function withDims(
  m: { id: string; provider: EmbeddingProvider; label: string }
): CatalogModel {
  const dims = knownDimensionsFor(m.id);
  return {
    ...m,
    supported_dimensions: dims.supportedDimensions,
    default_dimension: dims.defaultDimension,
  };
}

function chunkingPayload() {
  return {
    strategies: Object.entries(CHUNKING_STRATEGY_LABELS).map(([id, label]) => ({
      id,
      label,
    })),
    defaults: CHUNKING_DEFAULTS,
  };
}

const fallback = () =>
  FALLBACK_EMBEDDING_MODELS.map((m) =>
    withDims({ ...m, label: embeddingModelLabel(m.id) })
  );

/**
 * GET /api/settings/embeddings/models
 *
 * Lists the Amazon + Cohere embedding models available in the deployment
 * account, live from Bedrock (ListFoundationModels, output modality =
 * EMBEDDING) — same approach as the wiki-model picker. Per-model vector
 * dimensions are merged in from a known-dimensions lookup (the API doesn't
 * return them). Falls back to a static list + a warning if the Bedrock call
 * fails, so the UI always has something to render.
 */
export async function GET(request: NextRequest) {
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  try {
    const res = await bedrock.send(
      new ListFoundationModelsCommand({ byOutputModality: "EMBEDDING" })
    );
    const seen = new Set<string>();
    const models: CatalogModel[] = [];
    for (const m of res.modelSummaries ?? []) {
      if (m.modelLifecycle?.status && m.modelLifecycle.status !== "ACTIVE") {
        continue;
      }
      const provider = providerFromName(m.providerName);
      if (!provider || !m.modelId || seen.has(m.modelId)) continue;
      // Only surface curated base model ids that are valid as a KB
      // embeddingModelArn. ListFoundationModels also returns per-SKU variant
      // ids (e.g. `...v3:0:512`, `...v2:0:8k`) and legacy aliases that Bedrock
      // rejects when creating a knowledge base — skip those.
      if (!(m.modelId in KNOWN_EMBEDDING_DIMENSIONS)) continue;
      seen.add(m.modelId);
      models.push(
        withDims({ id: m.modelId, provider, label: embeddingModelLabel(m.modelId) })
      );
    }
    if (models.length === 0) {
      return NextResponse.json({
        models: fallback(),
        chunking: chunkingPayload(),
        warning: "No embedding models returned by Bedrock — showing defaults.",
      });
    }
    models.sort((a, b) =>
      a.provider === b.provider
        ? a.label.localeCompare(b.label)
        : a.provider.localeCompare(b.provider)
    );
    return NextResponse.json({
      models,
      chunking: chunkingPayload(),
      source: "live",
    });
  } catch (err) {
    return NextResponse.json({
      models: fallback(),
      chunking: chunkingPayload(),
      warning: `Couldn't list Bedrock embedding models (${err instanceof Error ? err.message : String(err)}). Showing defaults.`,
    });
  }
}
