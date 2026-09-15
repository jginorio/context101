import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from "@aws-sdk/client-bedrock-agent-runtime";

const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
const agentRuntime = new BedrockAgentRuntimeClient({ region });

export const DEFAULT_NUM_RESULTS = 6;
export const SEARCH_EXCLUDED_SOURCES = ["github", "code-wiki", "wiki"] as const;
const BEDROCK_MAX_RESULTS = 100;

export type RetrievedSource = {
  n: number;
  key: string;
  score: number | null;
  text: string;
};

/** Strip the s3://bucket/ prefix so a retrieve hit compares to a library key. */
export function keyFromUri(uri: string | undefined): string {
  if (!uri) return "";
  if (uri.startsWith("s3://")) {
    const rest = uri.slice(5);
    const slash = rest.indexOf("/");
    return slash >= 0 ? rest.slice(slash + 1) : rest;
  }
  return uri;
}

/**
 * Wiki overview pages are tagged `source=wiki` (see wiki-generator-ts
 * sidecars) and live under `wiki/` (including `wiki/code/`). Manual uploads
 * have no `source` sidecar — Bedrock `notIn` still matches those, so this
 * must not become an allowlist.
 */
export function shouldExcludeFromSearch(
  key: string,
  source?: string | null
): boolean {
  if (
    source &&
    (SEARCH_EXCLUDED_SOURCES as readonly string[]).includes(source)
  ) {
    return true;
  }
  return key.startsWith("wiki/");
}

export function searchSourceFilter(): {
  notIn: { key: string; value: string[] };
} {
  return {
    notIn: { key: "source", value: [...SEARCH_EXCLUDED_SOURCES] },
  };
}

export function searchRetrieveCount(limit: number): number {
  const capped = Math.max(1, Math.min(limit, BEDROCK_MAX_RESULTS));
  return Math.min(BEDROCK_MAX_RESULTS, Math.max(capped * 3, capped + 5));
}

export function filterSearchHits<T extends { key: string }>(
  hits: T[],
  limit: number
): T[] {
  const kept: T[] = [];
  for (const hit of hits) {
    if (shouldExcludeFromSearch(hit.key)) continue;
    kept.push(hit);
    if (kept.length >= limit) break;
  }
  return kept;
}

/**
 * Bedrock KB Retrieve for the active brain — the same call `/api/wiki/chat`
 * makes before it streams an answer. Mirrors MCP `search_knowledge`: raw
 * source docs only. Manual uploads have no `source` sidecar; the default
 * filter excludes github / code-wiki / wiki, then drops any `wiki/` key.
 */
export async function retrieveSources(opts: {
  knowledgeBaseId: string;
  query: string;
  includeRaw?: boolean;
  numberOfResults?: number;
  conflictScope?: { orgId: string; brainId: string };
}): Promise<RetrievedSource[]> {
  const limit = opts.numberOfResults ?? DEFAULT_NUM_RESULTS;
  const ret = await agentRuntime.send(
    new RetrieveCommand({
      knowledgeBaseId: opts.knowledgeBaseId,
      retrievalQuery: { text: opts.query },
      retrievalConfiguration: {
        vectorSearchConfiguration: {
          numberOfResults: opts.includeRaw
            ? limit
            : searchRetrieveCount(limit),
          ...(opts.includeRaw
            ? {}
            : {
                filter: searchSourceFilter(),
              }),
        },
      },
    })
  );
  const mapped = (ret.retrievalResults ?? []).map((r) => ({
    key: keyFromUri(r.location?.s3Location?.uri),
    score: r.score ?? null,
    text: (r.content?.text ?? "").trim(),
  }));
  const filtered = opts.includeRaw
    ? mapped.slice(0, limit)
    : filterSearchHits(mapped, limit);
  const hits = filtered.map((h, i) => ({ n: i + 1, ...h }));
  if (opts.conflictScope) {
    void import("@/lib/conflicts")
      .then(({ reportEvidence }) =>
        reportEvidence(opts.conflictScope!, {
          via: "query",
          query: opts.query,
          hits: hits.map((h) => ({ key: h.key, text: h.text })),
        })
      )
      .catch((err) => console.error("conflict detect (query):", err));
  }
  return hits;
}
