import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from "@aws-sdk/client-bedrock-agent-runtime";

const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
const agentRuntime = new BedrockAgentRuntimeClient({ region });

export const DEFAULT_NUM_RESULTS = 6;
/** Metadata denylist for Bedrock retrieve. Never include "github". */
export const SEARCH_EXCLUDED_SOURCES = ["code-wiki", "wiki"] as const;
const BEDROCK_MAX_RESULTS = 100;

const DOC_EXTENSIONS = [".md", ".mdx", ".txt", ".markdown", ".rst"] as const;
const CODE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".scala",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".swift",
  ".rb",
  ".php",
  ".lua",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".sql",
  ".css",
  ".scss",
  ".vue",
  ".svelte",
] as const;

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

function basename(key: string): string {
  const slash = key.lastIndexOf("/");
  return (slash >= 0 ? key.slice(slash + 1) : key).toLowerCase();
}

function suffix(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot) : "";
}

/** True for source-code files, including GitHub wrappers like `x.ts.md`. */
export function looksLikeSourceCode(key: string): boolean {
  const name = basename(key);
  if (!name) return false;
  for (const docExt of DOC_EXTENSIONS) {
    if (name.endsWith(docExt) && name !== docExt) {
      const inner = name.slice(0, -docExt.length);
      return (CODE_EXTENSIONS as readonly string[]).includes(suffix(inner));
    }
  }
  return (CODE_EXTENSIONS as readonly string[]).includes(suffix(name));
}

function isGithubKey(key: string, source?: string | null): boolean {
  return source === "github" || key.startsWith("sources/github/");
}

/**
 * Do not blanket-exclude `source=github` — GitHub-synced `.md` docs are
 * often the brain's primary content. Wiki overlay lives under `wiki/`
 * (including `wiki/code/` and untagged `_index.json`). Manual uploads have
 * no `source` sidecar; Bedrock `notIn` still matches those, so this must
 * not become an allowlist.
 */
export function shouldExcludeFromSearch(
  key: string,
  source?: string | null
): boolean {
  if (key.startsWith("wiki/")) return true;
  if (
    source &&
    (SEARCH_EXCLUDED_SOURCES as readonly string[]).includes(source)
  ) {
    return true;
  }
  if (isGithubKey(key, source) && looksLikeSourceCode(key)) return true;
  return false;
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

export function filterSearchHits<T extends { key: string; source?: string | null }>(
  hits: T[],
  limit: number
): T[] {
  const kept: T[] = [];
  for (const hit of hits) {
    if (shouldExcludeFromSearch(hit.key, hit.source)) continue;
    kept.push(hit);
    if (kept.length >= limit) break;
  }
  return kept;
}

function metadataSource(
  meta: Record<string, unknown> | undefined
): string | null {
  const value = meta?.source;
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

/**
 * Bedrock KB Retrieve for the active brain — the same call `/api/wiki/chat`
 * makes before it streams an answer. Mirrors MCP `search_knowledge`: raw
 * source docs including GitHub-synced documentation. Manual uploads have
 * no `source` sidecar; the default filter excludes tagged wiki / code-wiki,
 * then drops `wiki/` keys and GitHub source-code files.
 */
export async function retrieveSources(opts: {
  knowledgeBaseId: string;
  query: string;
  includeRaw?: boolean;
  numberOfResults?: number;
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
    source: metadataSource(r.metadata as Record<string, unknown> | undefined),
    score: r.score ?? null,
    text: (r.content?.text ?? "").trim(),
  }));
  const filtered = opts.includeRaw
    ? mapped.slice(0, limit)
    : filterSearchHits(mapped, limit);
  return filtered.map((h, i) => ({
    n: i + 1,
    key: h.key,
    score: h.score,
    text: h.text,
  }));
}
