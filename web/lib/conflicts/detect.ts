import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from "@aws-sdk/client-bedrock-agent-runtime";
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";

import { decideHashWatch } from "./enqueue-policy";
import { canonicalHash, fingerprintOf, provenanceId } from "./fingerprint";
import { parseProvenance } from "./parse";
import type { Contradiction } from "./queue";
import {
  enqueuePair,
  getBrainHandles,
  getDocHash,
  upsertDocHash,
} from "./queue";
import { loadObjectText } from "./solutioners";
import type {
  ConflictScope,
  EnqueueResult,
  EvidenceReport,
  Provenance,
  S3Key,
  Side,
} from "./types";

const INGEST_KEY_CAP = 20;
const MODEL_ID = "us.anthropic.claude-opus-4-7";

function keyFromUri(uri: string | undefined): string {
  if (!uri) return "";
  if (uri.startsWith("s3://")) {
    const rest = uri.slice(5);
    const slash = rest.indexOf("/");
    return slash >= 0 ? rest.slice(slash + 1) : rest;
  }
  return uri;
}

export type LoadedDoc = {
  key: S3Key;
  body: string;
  provenance: Provenance;
  canonicalHash: string;
};

export type Judge = {
  findContradictions(docs: LoadedDoc[]): Promise<Omit<Contradiction, "fingerprint">[]>;
};

export type DetectDeps = {
  judge?: Judge;
  loadDocs?: (keys: S3Key[]) => Promise<LoadedDoc[]>;
  retrieveNeighbors?: (
    query: string
  ) => Promise<readonly { key: S3Key; text: string }[]>;
};

const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
const agentRuntime = region
  ? new BedrockAgentRuntimeClient({ region })
  : null;
const bedrockRuntime = region
  ? new BedrockRuntimeClient({ region })
  : null;

export function skipJudge(): Judge {
  return { async findContradictions() { return []; } };
}

function parseJudgeJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

export function bedrockJudge(): Judge {
  if (!bedrockRuntime || process.env.CONFLICT_JUDGE === "off") {
    return skipJudge();
  }
  return {
    async findContradictions(docs) {
      if (docs.length < 2) return [];
      const payload = docs.map((d, i) => ({
        n: i + 1,
        key: d.key,
        kind: d.provenance.kind,
        text: d.body.slice(0, 4000),
      }));
      try {
        const res = await bedrockRuntime.send(
          new ConverseCommand({
            modelId: MODEL_ID,
            system: [
              {
                text: `You find factual contradictions between knowledge documents. A contradiction is two documents asserting incompatible values for the same topic. Ignore style, freshness wording, and citation headers.

Respond with a JSON array and nothing else. Each item:
{"topic":"short subject","title":"review headline","rationale":"why they cannot both be true","leftKey":"...","rightKey":"...","leftClaim":"...","rightClaim":"...","leftLoser":"full markdown that would make the left doc consistent if it lost","rightLoser":"full markdown that would make the right doc consistent if it lost"}

If nothing contradicts, return [].`,
              },
            ],
            messages: [
              {
                role: "user",
                content: [{ text: JSON.stringify(payload) }],
              },
            ],
            inferenceConfig: { maxTokens: 4000 },
          })
        );
        const text = res.output?.message?.content?.[0]?.text ?? "[]";
        const parsed = parseJudgeJson(text);
        if (!Array.isArray(parsed)) return [];
        const byKey = new Map(docs.map((d) => [d.key, d]));
        const out: Omit<Contradiction, "fingerprint">[] = [];
        for (const item of parsed) {
          if (!item || typeof item !== "object") continue;
          const rec = item as Record<string, unknown>;
          const leftDoc = byKey.get(String(rec.leftKey ?? ""));
          const rightDoc = byKey.get(String(rec.rightKey ?? ""));
          if (!leftDoc || !rightDoc || leftDoc.key === rightDoc.key) continue;
          const topic = String(rec.topic ?? "").trim();
          if (!topic) continue;
          const [a, b] =
            leftDoc.key < rightDoc.key
              ? [leftDoc, rightDoc]
              : [rightDoc, leftDoc];
          const aIsLeft = a.key === leftDoc.key;
          out.push({
            topic,
            title: String(rec.title ?? topic),
            rationale: String(rec.rationale ?? ""),
            left: sideFromDoc(
              a,
              topic,
              String((aIsLeft ? rec.leftClaim : rec.rightClaim) ?? "")
            ),
            right: sideFromDoc(
              b,
              topic,
              String((aIsLeft ? rec.rightClaim : rec.leftClaim) ?? "")
            ),
            proposedLoserBody: {
              left: String((aIsLeft ? rec.leftLoser : rec.rightLoser) ?? a.body),
              right: String((aIsLeft ? rec.rightLoser : rec.leftLoser) ?? b.body),
            },
          });
        }
        return out;
      } catch (err) {
        console.error("conflict judge failed:", err);
        return [];
      }
    },
  };
}

function sideFromDoc(doc: LoadedDoc, topic: string, claim: string): Side {
  return {
    provenance: doc.provenance,
    claim: {
      topic,
      text: claim || doc.body.slice(0, 280),
      excerpt: doc.body.slice(0, 280),
    },
    canonicalHash: doc.canonicalHash,
  };
}

export async function pairContradictions(
  docs: LoadedDoc[],
  judge: Judge,
  scope: ConflictScope
): Promise<Contradiction[]> {
  if (docs.length < 2) return [];
  const found = await judge.findContradictions(docs);
  return found.map((c) => ({
    ...c,
    fingerprint: fingerprintOf(
      scope.orgId,
      scope.brainId,
      c.topic,
      provenanceId(c.left.provenance),
      provenanceId(c.right.provenance)
    ),
  }));
}

async function defaultLoadDocs(
  bucket: string,
  keys: S3Key[]
): Promise<LoadedDoc[]> {
  const unique = [...new Set(keys)].filter(
    (k) =>
      !k.endsWith(".metadata.json") &&
      !k.endsWith(".keep") &&
      !k.endsWith("/") &&
      !k.startsWith("wiki/")
  );
  const docs: LoadedDoc[] = [];
  for (const key of unique) {
    const body = await loadObjectText(bucket, key);
    if (body == null) continue;
    const sidecarRaw = await loadObjectText(bucket, `${key}.metadata.json`);
    let sidecar: unknown = null;
    if (sidecarRaw) {
      try {
        sidecar = JSON.parse(sidecarRaw);
      } catch {
        sidecar = null;
      }
    }
    const provenance = parseProvenance(key, sidecar);
    if (!provenance) continue;
    docs.push({
      key,
      body,
      provenance,
      canonicalHash: canonicalHash(body),
    });
  }
  return docs;
}

async function defaultRetrieveNeighbors(
  kbId: string,
  query: string
): Promise<{ key: S3Key; text: string }[]> {
  if (!agentRuntime) return [];
  const ret = await agentRuntime.send(
    new RetrieveCommand({
      knowledgeBaseId: kbId,
      retrievalQuery: { text: query },
      retrievalConfiguration: {
        vectorSearchConfiguration: { numberOfResults: 12 },
      },
    })
  );
  return (ret.retrievalResults ?? []).map((r) => ({
    key: keyFromUri(r.location?.s3Location?.uri),
    text: (r.content?.text ?? "").trim(),
  }));
}

function neighborQuery(doc: LoadedDoc): string {
  const heading = doc.body.split("\n").find((l) => l.startsWith("# "));
  if (heading) return heading.replace(/^#+\s*/, "").trim();
  return doc.body.slice(0, 280);
}

export async function detectFromReport(
  scope: ConflictScope,
  report: EvidenceReport,
  deps: DetectDeps = {}
): Promise<EnqueueResult[]> {
  const handles = await getBrainHandles(scope);
  if (!handles?.docsBucket) return [];
  const bucket = handles.docsBucket;
  const judge = deps.judge ?? bedrockJudge();
  const loadDocs =
    deps.loadDocs ?? ((keys) => defaultLoadDocs(bucket, keys));
  const retrieveNeighbors =
    deps.retrieveNeighbors ??
    (handles.kbId
      ? (query: string) => defaultRetrieveNeighbors(handles.kbId!, query)
      : async () => []);

  if (report.via === "ingest") {
    return detectIngest(scope, report.keys, {
      loadDocs,
      retrieveNeighbors,
      judge,
    });
  }
  return detectQuery(scope, report, { loadDocs, retrieveNeighbors, judge });
}

async function detectIngest(
  scope: ConflictScope,
  keys: S3Key[],
  deps: Required<Pick<DetectDeps, "judge" | "loadDocs" | "retrieveNeighbors">>
): Promise<EnqueueResult[]> {
  const triggerKeys = keys
    .filter(
      (k) =>
        !k.endsWith(".metadata.json") &&
        !k.endsWith(".keep") &&
        !k.startsWith("wiki/")
    )
    .slice(0, INGEST_KEY_CAP);
  const triggerDocs = await deps.loadDocs(triggerKeys);
  const changed: LoadedDoc[] = [];
  for (const doc of triggerDocs) {
    const stored = await getDocHash(scope, doc.key);
    const watch = decideHashWatch({
      storedHash: stored,
      incomingHash: doc.canonicalHash,
    });
    await upsertDocHash(scope, doc.key, doc.canonicalHash);
    if (watch === "continue") changed.push(doc);
  }
  if (changed.length === 0) {
    return [{ kind: "skipped", reason: "pending-unchanged" }];
  }
  const neighborKeys = new Set<string>(changed.map((d) => d.key));
  for (const doc of changed) {
    const hits = await deps.retrieveNeighbors(neighborQuery(doc));
    for (const hit of hits) neighborKeys.add(hit.key);
  }
  const docs = await deps.loadDocs([...neighborKeys]);
  return enqueueFromDocs(scope, docs, "ingest", deps.judge);
}

async function detectQuery(
  scope: ConflictScope,
  report: Extract<EvidenceReport, { via: "query" }>,
  deps: Required<Pick<DetectDeps, "judge" | "loadDocs" | "retrieveNeighbors">>
): Promise<EnqueueResult[]> {
  const keys = new Set(report.hits.map((h) => h.key));
  try {
    const extra = await deps.retrieveNeighbors(report.query);
    for (const hit of extra) keys.add(hit.key);
  } catch (err) {
    console.error("conflict neighbor retrieve failed:", err);
  }
  let docs = await deps.loadDocs([...keys]);
  if (docs.length < 2) {
    const fromHits: LoadedDoc[] = [];
    for (const hit of report.hits) {
      const provenance = parseProvenance(hit.key, {
        metadataAttributes: sidecarFromKey(hit.key),
      });
      if (!provenance) continue;
      fromHits.push({
        key: hit.key,
        body: hit.text,
        provenance,
        canonicalHash: canonicalHash(hit.text),
      });
    }
    docs = fromHits;
  }
  return enqueueFromDocs(scope, docs, "query", deps.judge);
}

function sidecarFromKey(key: string): Record<string, unknown> {
  if (key.startsWith("sources/github/")) {
    return { source: "github", language: "markdown" };
  }
  if (key.startsWith("sources/notion/")) return { source: "notion" };
  if (key.startsWith("sources/docs/")) return { source: "docs" };
  if (key.startsWith("sources/sheets/")) return { source: "sheets" };
  if (key.startsWith("sources/slides/")) return { source: "slides" };
  if (key.startsWith("wiki/")) return { source: "wiki" };
  return {};
}

async function enqueueFromDocs(
  scope: ConflictScope,
  docs: LoadedDoc[],
  via: "ingest" | "query",
  judge: Judge
): Promise<EnqueueResult[]> {
  if (docs.length < 2) return [{ kind: "skipped", reason: "too-few-docs" }];
  const pairs = await pairContradictions(docs, judge, scope);
  if (pairs.length === 0) {
    return [{ kind: "skipped", reason: "no-contradiction" }];
  }
  const results: EnqueueResult[] = [];
  for (const pair of pairs) {
    results.push(await enqueuePair(scope, pair, via));
  }
  return results;
}
