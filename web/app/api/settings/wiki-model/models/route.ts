import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import {
  BedrockClient,
  ListFoundationModelsCommand,
} from "@aws-sdk/client-bedrock";

import { readAuthContext } from "@/lib/brains-server";
import { db } from "@/lib/db/client";
import { brains } from "@/lib/db/schema";

const region = process.env.AWS_REGION ?? "us-east-1";
const secrets = new SecretsManagerClient({ region });
const bedrock = new BedrockClient({ region });

const PROVIDERS = [
  "bedrock",
  "anthropic",
  "openai",
  "grok",
  "gemini",
  "claude-code",
] as const;
type Provider = (typeof PROVIDERS)[number];

// claude-code's `--model` accepts short aliases or a full model id; the model
// is optional (blank uses the subscription default), so we offer suggestions
// rather than a live catalog (there's no list endpoint, and no key is needed).
const CLAUDE_CODE_MODELS = ["opus", "sonnet", "haiku"];

// Popular Bedrock model providers we surface (by ListFoundationModels'
// providerName). Anything else (and legacy/non-text models) is filtered out.
const BEDROCK_POPULAR = new Set([
  "Anthropic",
  "Meta",
  "Amazon",
  "Mistral AI",
  "Cohere",
  "AI21 Labs",
  "DeepSeek",
  "OpenAI",
]);

const BEDROCK_FALLBACK = ["us.anthropic.claude-opus-4-7"];

type ModelGroup = { provider: string; models: string[] };

// Cross-region inference geo prefix for the deployment region. Models that
// only support INFERENCE_PROFILE are invoked via "<geo>.<modelId>" (e.g.
// us.anthropic.claude-opus-4-7), which is what the Converse API accepts.
function regionGeo(r: string): string {
  if (r.startsWith("eu-")) return "eu";
  if (r.startsWith("ap-")) return "apac";
  return "us";
}

/**
 * Live Bedrock catalog grouped by provider, built from the ACTIVE
 * (non-legacy) TEXT foundation models of popular providers. On-demand models
 * use their base id; inference-profile-only models use the cross-region
 * "<geo>.<modelId>" id. Custom ids are still accepted via free text.
 */
async function bedrockGroups(): Promise<ModelGroup[]> {
  const geo = regionGeo(region);
  const fms = await bedrock.send(
    new ListFoundationModelsCommand({ byOutputModality: "TEXT" })
  );

  const groups = new Map<string, Set<string>>();
  for (const m of fms.modelSummaries ?? []) {
    if (m.modelLifecycle?.status !== "ACTIVE") continue;
    if (!m.modelId || !m.providerName || !BEDROCK_POPULAR.has(m.providerName)) {
      continue;
    }
    // Skip non-generative text models that still report TEXT output
    // (embeddings, rerankers) — they can't generate a wiki.
    if (/embed|rerank/i.test(m.modelId)) continue;
    // Cast to string[] — the SDK's InferenceType union lags the API, which
    // also returns "INFERENCE_PROFILE".
    const inf = (m.inferenceTypesSupported ?? []) as string[];
    let id: string | undefined;
    if (inf.includes("ON_DEMAND")) id = m.modelId;
    else if (inf.includes("INFERENCE_PROFILE")) id = `${geo}.${m.modelId}`;
    if (!id) continue;
    if (!groups.has(m.providerName)) groups.set(m.providerName, new Set());
    groups.get(m.providerName)!.add(id);
  }

  return [...groups.entries()]
    .map(([provider, ids]) => ({
      provider,
      models: [...ids].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

async function fetchOpenAICompatible(
  url: string,
  apiKey: string
): Promise<string[]> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
  const json = (await res.json()) as { data?: { id?: string }[] };
  return (json.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => !!id);
}

async function fetchAnthropic(apiKey: string): Promise<string[]> {
  const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
  const json = (await res.json()) as { data?: { id?: string }[] };
  return (json.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => !!id);
}

async function fetchGemini(apiKey: string): Promise<string[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=200`
  );
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
  const json = (await res.json()) as {
    models?: { name?: string; supportedGenerationMethods?: string[] }[];
  };
  return (json.models ?? [])
    .filter((m) =>
      (m.supportedGenerationMethods ?? []).includes("generateContent")
    )
    .map((m) => (m.name ?? "").replace(/^models\//, ""))
    .filter(Boolean);
}

async function resolveKey(
  orgId: string,
  brainId: string,
  typedKey: string | null
): Promise<string | null> {
  if (typedKey) return typedKey;
  if (!db) return null;
  const [row] = await db
    .select({ arn: brains.wikiLlmKeySecretArn })
    .from(brains)
    .where(and(eq(brains.orgId, orgId), eq(brains.id, brainId)))
    .limit(1);
  if (!row?.arn) return null;
  const res = await secrets
    .send(new GetSecretValueCommand({ SecretId: row.arn }))
    .catch(() => null);
  return res?.SecretString ?? null;
}

/**
 * GET /api/settings/wiki-model/models?provider=&brain=[&key=]
 *
 * Returns the available model ids for a provider so the Settings UI can offer
 * a searchable dropdown. For bring-your-own providers it lists live using the
 * caller-supplied `key` (not-yet-saved) or the brain's stored key. Always
 * returns 200; on failure it returns an empty list + a `warning` so the UI
 * falls back to free-text entry.
 */
export async function GET(request: NextRequest) {
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const provider = request.nextUrl.searchParams.get("provider") as Provider | null;
  const brainId = request.nextUrl.searchParams.get("brain");
  const typedKey = request.nextUrl.searchParams.get("key");

  if (!provider || !PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: "invalid provider" }, { status: 400 });
  }

  if (provider === "bedrock") {
    try {
      const groups = await bedrockGroups();
      if (groups.length === 0) {
        return NextResponse.json({
          groups: [{ provider: "Anthropic", models: BEDROCK_FALLBACK }],
          warning: "No Bedrock models found — you can type a model id.",
        });
      }
      return NextResponse.json({ groups, source: "live" });
    } catch (err) {
      return NextResponse.json({
        groups: [{ provider: "Anthropic", models: BEDROCK_FALLBACK }],
        warning: `Couldn't list Bedrock models (${err instanceof Error ? err.message : String(err)}). You can type a model id.`,
      });
    }
  }
  if (provider === "claude-code") {
    return NextResponse.json({
      models: CLAUDE_CODE_MODELS,
      warning:
        "Optional — leave blank to use your Claude subscription's default model.",
    });
  }
  if (!brainId) {
    return NextResponse.json({ error: "brain is required" }, { status: 400 });
  }

  try {
    const key = await resolveKey(auth.orgId, brainId, typedKey);
    if (!key) {
      return NextResponse.json({
        models: [],
        warning: "Add an API key to list this provider's models.",
      });
    }

    let models: string[] = [];
    if (provider === "openai") {
      models = await fetchOpenAICompatible("https://api.openai.com/v1/models", key);
    } else if (provider === "grok") {
      models = await fetchOpenAICompatible("https://api.x.ai/v1/models", key);
    } else if (provider === "anthropic") {
      models = await fetchAnthropic(key);
    } else if (provider === "gemini") {
      models = await fetchGemini(key);
    }

    models.sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ models, source: "live" });
  } catch (err) {
    return NextResponse.json({
      models: [],
      warning: `Couldn't list models: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
