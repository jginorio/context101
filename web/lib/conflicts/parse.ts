import type {
  Conflict,
  ConflictFail,
  ConflictId,
  EvidenceReport,
  Markdown,
  Provenance,
  Resolution,
  S3Key,
  Side,
  SideId,
  WriteReceipt,
} from "./types";

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === "object" && !Array.isArray(raw);
}

function asString(raw: unknown): string | null {
  return typeof raw === "string" ? raw : null;
}

export function parseEvidenceReport(raw: unknown): EvidenceReport {
  if (!isRecord(raw)) throw new ParseError("evidence body is required");
  if (raw.via === "ingest") {
    const bucket = asString(raw.bucket)?.trim();
    if (!bucket) throw new ParseError("bucket is required");
    if (!Array.isArray(raw.keys)) throw new ParseError("keys is required");
    const keys = raw.keys.filter((k): k is string => typeof k === "string");
    return { via: "ingest", bucket, keys };
  }
  if (raw.via === "query") {
    const query = asString(raw.query);
    if (query == null) throw new ParseError("query is required");
    if (!Array.isArray(raw.hits)) throw new ParseError("hits is required");
    const hits: { key: S3Key; text: string }[] = [];
    for (const hit of raw.hits) {
      if (!isRecord(hit)) continue;
      const key = asString(hit.key);
      const text = asString(hit.text);
      if (key == null || text == null) continue;
      hits.push({ key, text });
    }
    return { via: "query", query, hits };
  }
  throw new ParseError("via must be ingest or query");
}

export function parseApproveBody(
  raw: unknown
): { id: ConflictId; resolution: Resolution } {
  if (!isRecord(raw)) throw new ParseError("approve body is required");
  const id = asString(raw.id)?.trim();
  if (!id) throw new ParseError("id is required");
  const resolution = parseResolution(raw.resolution ?? raw);
  return { id, resolution };
}

function parseResolution(raw: unknown): Resolution {
  if (!isRecord(raw)) throw new ParseError("resolution is required");
  if (raw.kind === "keep") {
    const winner = raw.winner;
    if (winner !== "left" && winner !== "right") {
      throw new ParseError("winner must be left or right");
    }
    const loserBody = asString(raw.loserBody);
    if (loserBody == null) throw new ParseError("loserBody is required");
    return { kind: "keep", winner, loserBody };
  }
  if (raw.kind === "merge") {
    const leftBody = asString(raw.leftBody);
    const rightBody = asString(raw.rightBody);
    if (leftBody == null || rightBody == null) {
      throw new ParseError("merge requires leftBody and rightBody");
    }
    return { kind: "merge", leftBody, rightBody };
  }
  throw new ParseError("resolution.kind must be keep or merge");
}

export function sidecarAttrs(sidecar: unknown): Record<string, unknown> {
  if (!isRecord(sidecar)) return {};
  const attrs = sidecar.metadataAttributes;
  return isRecord(attrs) ? attrs : sidecar;
}

function dropKey(key: string): boolean {
  if (key.startsWith("wiki/")) return true;
  if (key.endsWith(".metadata.json")) return true;
  if (key.endsWith(".keep")) return true;
  if (key.endsWith("/")) return true;
  return false;
}

export function parseProvenance(
  key: S3Key,
  sidecar: unknown
): Provenance | null {
  if (dropKey(key)) return null;
  const attrs = sidecarAttrs(sidecar);
  const source = asString(attrs.source);
  if (source === "code-wiki") return null;
  if (source === "github") {
    const language = (asString(attrs.language) ?? "").toLowerCase();
    if (language !== "markdown") return null;
    const repo = asString(attrs.repo);
    const repoPath = asString(attrs.path);
    const connectorId = asString(attrs.connector_id);
    const branch = asString(attrs.branch) ?? "main";
    const blobSha = asString(attrs.commit_sha) ?? "";
    if (!repo || !repoPath || !connectorId) return null;
    return {
      kind: "github",
      key,
      connectorId,
      repo,
      repoPath,
      branch,
      blobSha,
      language: "markdown",
    };
  }
  if (source === "notion") {
    const pageId = asString(attrs.notion_page_id);
    const connectorId = asString(attrs.connector_id);
    if (!pageId || !connectorId) return null;
    return { kind: "notion", key, connectorId, pageId };
  }
  if (source === "docs" || source === "sheets" || source === "slides") {
    const connectorId = asString(attrs.connector_id);
    if (!connectorId) return null;
    return { kind: "google", key, connectorId, sourceType: source };
  }
  return { kind: "manual", key };
}

function parseStoredProvenance(raw: unknown): Provenance {
  if (!isRecord(raw)) throw new ParseError("provenance is required");
  const key = asString(raw.key);
  if (!key) throw new ParseError("provenance.key is required");
  if (raw.kind === "github") {
    if (raw.language !== "markdown") {
      throw new ParseError("github language must be markdown");
    }
    const repo = asString(raw.repo);
    const repoPath = asString(raw.repoPath);
    const connectorId = asString(raw.connectorId);
    const branch = asString(raw.branch) ?? "main";
    const blobSha = asString(raw.blobSha) ?? "";
    if (!repo || !repoPath || !connectorId) {
      throw new ParseError("github provenance is incomplete");
    }
    return {
      kind: "github",
      key,
      connectorId,
      repo,
      repoPath,
      branch,
      blobSha,
      language: "markdown",
    };
  }
  if (raw.kind === "notion") {
    const pageId = asString(raw.pageId);
    const connectorId = asString(raw.connectorId);
    if (!pageId || !connectorId) {
      throw new ParseError("notion provenance is incomplete");
    }
    return { kind: "notion", key, connectorId, pageId };
  }
  if (raw.kind === "google") {
    const sourceType = raw.sourceType;
    const connectorId = asString(raw.connectorId);
    if (
      (sourceType !== "docs" &&
        sourceType !== "sheets" &&
        sourceType !== "slides") ||
      !connectorId
    ) {
      throw new ParseError("google provenance is incomplete");
    }
    return { kind: "google", key, connectorId, sourceType };
  }
  if (raw.kind === "manual") return { kind: "manual", key };
  throw new ParseError("unknown provenance kind");
}

function parseSide(raw: unknown, fallbackTopic: string): Side {
  if (!isRecord(raw)) throw new ParseError("side is required");
  const provenance = parseStoredProvenance(raw.provenance);
  const claimRaw = isRecord(raw.claim) ? raw.claim : {};
  const topic = asString(claimRaw.topic) ?? fallbackTopic;
  const text = asString(claimRaw.text) ?? "";
  const excerpt = asString(claimRaw.excerpt) ?? text.slice(0, 280);
  const canonicalHash = asString(raw.canonicalHash) ?? "";
  return {
    provenance,
    claim: { topic, text, excerpt },
    canonicalHash,
  };
}

function parseLoserBody(raw: unknown): { left: Markdown; right: Markdown } {
  if (!isRecord(raw)) return { left: "", right: "" };
  return {
    left: asString(raw.left) ?? "",
    right: asString(raw.right) ?? "",
  };
}

function parseStoredResolution(raw: unknown): Resolution | null {
  if (!isRecord(raw)) return null;
  try {
    return parseResolution(raw);
  } catch {
    return null;
  }
}

function parseWrote(raw: unknown): WriteReceipt[] {
  if (!Array.isArray(raw)) return [];
  const out: WriteReceipt[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    if (item.kind === "s3") {
      const key = asString(item.key);
      if (key) out.push({ kind: "s3", key });
      continue;
    }
    if (item.kind === "github") {
      const key = asString(item.key);
      const repo = asString(item.repo);
      const repoPath = asString(item.repoPath);
      const beforeSha = asString(item.beforeSha);
      const afterSha = asString(item.afterSha);
      if (key && repo && repoPath && beforeSha && afterSha) {
        out.push({ kind: "github", key, repo, repoPath, beforeSha, afterSha });
      }
    }
  }
  return out;
}

export function parseConflictRow(row: unknown): Conflict {
  if (!isRecord(row)) throw new ParseError("conflict row is required");
  const id = asString(row.id);
  const orgId = asString(row.orgId) ?? asString(row.org_id);
  const brainId = asString(row.brainId) ?? asString(row.brain_id);
  const status = asString(row.status);
  const fingerprint = asString(row.fingerprint);
  const topic = asString(row.topic);
  const title = asString(row.title);
  if (!id || !orgId || !brainId || !status || !fingerprint || !topic || !title) {
    throw new ParseError("conflict row is incomplete");
  }
  const left = parseSide(row.leftSide ?? row.left_side, topic);
  const right = parseSide(row.rightSide ?? row.right_side, topic);
  const viaRaw =
    asString(row.lastDetectedVia) ?? asString(row.last_detected_via);
  const lastDetectedVia = viaRaw === "ingest" ? "ingest" : "query";
  const createdAt = toDate(row.createdAt ?? row.created_at);
  const updatedAt = toDate(row.updatedAt ?? row.updated_at);
  const occurrenceCount =
    typeof row.occurrenceCount === "number"
      ? row.occurrenceCount
      : typeof row.occurrence_count === "number"
        ? row.occurrence_count
        : 1;
  const base = {
    id,
    orgId,
    brainId,
    fingerprint,
    topic,
    title,
    rationale: asString(row.rationale) ?? "",
    left,
    right,
    proposedLoserBody: parseLoserBody(
      row.proposedLoserBody ?? row.proposed_loser_body
    ),
    occurrenceCount,
    lastDetectedVia,
    createdAt,
    updatedAt,
  } as const;
  if (status === "pending") {
    return {
      ...base,
      status: "pending",
      lastError: asString(row.lastError) ?? asString(row.last_error),
    };
  }
  if (status === "applying") {
    return {
      ...base,
      status: "applying",
      lastError: asString(row.lastError) ?? asString(row.last_error),
    };
  }
  const reviewedBy = asString(row.reviewedBy) ?? asString(row.reviewed_by) ?? "";
  const reviewedAt = toDate(row.reviewedAt ?? row.reviewed_at);
  if (status === "rejected") {
    return { ...base, status: "rejected", reviewedBy, reviewedAt };
  }
  if (status === "accepted") {
    const resolution = parseStoredResolution(row.resolution);
    if (!resolution) throw new ParseError("accepted row is missing resolution");
    const applyRaw = row.applyRecord ?? row.apply_record;
    const applyRecord = isRecord(applyRaw) ? applyRaw : {};
    return {
      ...base,
      status: "accepted",
      resolution,
      apply: {
        wrote: parseWrote(applyRecord.wrote),
        pinnedAt: toDate(applyRecord.pinnedAt ?? applyRecord.pinned_at),
      },
      reviewedBy,
      reviewedAt,
    };
  }
  throw new ParseError(`unknown conflict status ${status}`);
}

function toDate(raw: unknown): Date {
  if (raw instanceof Date) return raw;
  if (typeof raw === "string" || typeof raw === "number") return new Date(raw);
  return new Date(0);
}

export function failStatus(fail: ConflictFail): number {
  if (fail.kind === "not-found") return 404;
  if (fail.kind === "github-forbidden") return 403;
  return 409;
}

export function loserSide(winner: SideId): SideId {
  return winner === "left" ? "right" : "left";
}
