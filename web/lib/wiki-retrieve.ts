import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from "@aws-sdk/client-bedrock-agent-runtime";

const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
const agentRuntime = new BedrockAgentRuntimeClient({ region });

export const DEFAULT_NUM_RESULTS = 6;

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
 * Bedrock KB Retrieve for the active brain — the same call `/api/wiki/chat`
 * makes before it streams an answer. Manual uploads have no `source`
 * sidecar; the default filter excludes only github / code-wiki.
 */
export async function retrieveSources(opts: {
  knowledgeBaseId: string;
  query: string;
  includeRaw?: boolean;
  numberOfResults?: number;
}): Promise<RetrievedSource[]> {
  const ret = await agentRuntime.send(
    new RetrieveCommand({
      knowledgeBaseId: opts.knowledgeBaseId,
      retrievalQuery: { text: opts.query },
      retrievalConfiguration: {
        vectorSearchConfiguration: {
          numberOfResults: opts.numberOfResults ?? DEFAULT_NUM_RESULTS,
          ...(opts.includeRaw
            ? {}
            : {
                filter: {
                  notIn: { key: "source", value: ["github", "code-wiki"] },
                },
              }),
        },
      },
    })
  );
  return (ret.retrievalResults ?? []).map((r, i) => ({
    n: i + 1,
    key: keyFromUri(r.location?.s3Location?.uri),
    score: r.score ?? null,
    text: (r.content?.text ?? "").trim(),
  }));
}
