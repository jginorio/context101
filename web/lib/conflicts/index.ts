import { detectFromReport, type DetectDeps } from "./detect";
import {
  casApplyingToAccepted,
  casPendingToApplying,
  casPendingToRejected,
  getConflictRow,
  getBrainHandles,
  listConflictRows,
  revertApplyingToPending,
  upsertPin,
} from "./queue";
import { applyWrites, pinFromApply, planWrites } from "./solutioners";
import type {
  Actor,
  ApplyResult,
  ClientConflict,
  ClientSide,
  Conflict,
  ConflictId,
  ConflictScope,
  EnqueueResult,
  EvidenceReport,
  ListStatus,
  Provenance,
  RejectedConflict,
  Resolution,
} from "./types";
import { ConflictFailure } from "./types";

export type { DetectDeps } from "./detect";
export { parseApproveBody, parseEvidenceReport, parseProvenance, parseConflictRow, loserSide } from "./parse";
export { fingerprintOf, provenanceId, canonicalHash } from "./fingerprint";
export { pairContradictions } from "./detect";
export { decideEnqueue } from "./enqueue-policy";
export { getBrainByDocsBucket } from "./queue";
export { ConflictFailure } from "./types";
export type {
  Actor,
  ApplyResult,
  ClientConflict,
  Conflict,
  ConflictFail,
  ConflictId,
  ConflictScope,
  EnqueueResult,
  EvidenceReport,
  ListStatus,
  Provenance,
  RejectedConflict,
  Resolution,
} from "./types";

function provenanceLabel(p: Provenance): string {
  switch (p.kind) {
    case "github":
      return `${p.repo}:${p.repoPath}`;
    case "notion":
      return `notion:${p.pageId}`;
    case "google":
      return `${p.sourceType}:${p.key}`;
    case "manual":
      return p.key;
  }
}

function toClientSide(side: Conflict["left"]): ClientSide {
  return {
    key: side.provenance.key,
    kind: side.provenance.kind,
    claim: side.claim.text,
    excerpt: side.claim.excerpt,
    label: provenanceLabel(side.provenance),
    unwritable:
      side.provenance.kind === "notion" || side.provenance.kind === "google",
  };
}

export function toClientConflict(conflict: Conflict): ClientConflict {
  return {
    id: conflict.id,
    status: conflict.status === "applying" ? "pending" : conflict.status,
    created_at: conflict.createdAt.toISOString(),
    topic: conflict.topic,
    title: conflict.title,
    rationale: conflict.rationale || undefined,
    left: toClientSide(conflict.left),
    right: toClientSide(conflict.right),
    proposed_loser_body: conflict.proposedLoserBody,
    occurrence_count: conflict.occurrenceCount,
    last_error:
      conflict.status === "pending" || conflict.status === "applying"
        ? conflict.lastError ?? undefined
        : undefined,
    last_detected_via: conflict.lastDetectedVia,
    reviewed_at:
      conflict.status === "accepted" || conflict.status === "rejected"
        ? conflict.reviewedAt.toISOString()
        : undefined,
    reviewer_email:
      conflict.status === "accepted" || conflict.status === "rejected"
        ? conflict.reviewedBy
        : undefined,
  };
}

export async function reportEvidence(
  scope: ConflictScope,
  report: EvidenceReport,
  deps?: DetectDeps
): Promise<EnqueueResult[]> {
  try {
    return await detectFromReport(scope, report, deps);
  } catch (err) {
    console.error("conflict detect:", err);
    return [];
  }
}

export async function listConflicts(
  scope: ConflictScope,
  status: ListStatus
): Promise<Conflict[]> {
  return listConflictRows(scope, status);
}

export async function getConflict(
  scope: ConflictScope,
  id: ConflictId
): Promise<Conflict | null> {
  return getConflictRow(scope, id);
}

export async function approveConflict(
  scope: ConflictScope,
  id: ConflictId,
  resolution: Resolution,
  actor: Actor
): Promise<ApplyResult> {
  const applying = await casPendingToApplying(scope, id);
  try {
    const targets = planWrites(applying, resolution);
    const handles = await getBrainHandles(scope);
    if (!handles?.docsBucket) {
      throw new Error("brain has no docs bucket");
    }
    const wrote = await applyWrites(scope, handles.docsBucket, targets);
    const pin = pinFromApply({
      conflict: applying,
      resolution,
      wrote,
      outcome: "accepted",
    });
    await upsertPin(scope, pin);
    const accepted = await casApplyingToAccepted(
      scope,
      id,
      resolution,
      { wrote, pinnedAt: pin.pinnedAt },
      actor
    );
    if (accepted.status !== "accepted") {
      throw new ConflictFailure({ kind: "not-pending" });
    }
    return { conflict: accepted, wrote };
  } catch (err) {
    const fail = err instanceof ConflictFailure ? err.fail.kind : null;
    const message = err instanceof Error ? err.message : String(err);
    await revertApplyingToPending(
      scope,
      id,
      fail === "unwritable-loser" ? fail : message.slice(0, 2000)
    );
    throw err;
  }
}

export async function rejectConflict(
  scope: ConflictScope,
  id: ConflictId,
  actor: Actor
): Promise<RejectedConflict> {
  const rejected = await casPendingToRejected(scope, id, actor);
  await upsertPin(scope, {
    fingerprint: rejected.fingerprint,
    outcome: "rejected",
    leftKey: rejected.left.provenance.key,
    rightKey: rejected.right.provenance.key,
    topic: rejected.topic,
    hashes: {
      left: rejected.left.canonicalHash,
      right: rejected.right.canonicalHash,
    },
    githubBlobShas: {},
    conflictId: rejected.id,
    pinnedAt: new Date(),
  });
  return rejected;
}
