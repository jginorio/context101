import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  brains,
  conflictDocHashes,
  conflictPins,
  conflicts as conflictsTable,
} from "@/lib/db/schema";

import { decideEnqueue } from "./enqueue-policy";
import { parseConflictRow } from "./parse";
import type {
  Actor,
  ApplyRecord,
  Conflict,
  ConflictId,
  ConflictScope,
  ContentHash,
  EnqueueResult,
  Fingerprint,
  ListStatus,
  Pin,
  RejectedConflict,
  Resolution,
  S3Key,
  Side,
} from "./types";
import { ConflictFailure } from "./types";

function requireDb() {
  if (!db) throw new Error("DATABASE_URL is not configured");
  return db;
}

export type Contradiction = {
  topic: string;
  title: string;
  rationale: string;
  left: Side;
  right: Side;
  fingerprint: Fingerprint;
  proposedLoserBody: { left: string; right: string };
};

function pinFromRow(row: typeof conflictPins.$inferSelect): Pin {
  const hashes = (row.hashes ?? {}) as Pin["hashes"];
  return {
    fingerprint: row.fingerprint,
    outcome: row.outcome === "accepted" ? "accepted" : "rejected",
    leftKey: row.leftKey,
    rightKey: row.rightKey,
    topic: row.topic,
    hashes: {
      left: String(hashes.left ?? ""),
      right: String(hashes.right ?? ""),
    },
    githubBlobShas: (row.githubBlobShas ?? {}) as Pin["githubBlobShas"],
    conflictId: row.conflictId,
    pinnedAt: row.pinnedAt,
  };
}

export async function getPin(
  scope: ConflictScope,
  fingerprint: Fingerprint
): Promise<Pin | null> {
  const [row] = await requireDb()
    .select()
    .from(conflictPins)
    .where(
      and(
        eq(conflictPins.orgId, scope.orgId),
        eq(conflictPins.brainId, scope.brainId),
        eq(conflictPins.fingerprint, fingerprint)
      )
    )
    .limit(1);
  return row ? pinFromRow(row) : null;
}

export async function getOpenByFingerprint(
  scope: ConflictScope,
  fingerprint: Fingerprint
): Promise<Conflict | null> {
  const [row] = await requireDb()
    .select()
    .from(conflictsTable)
    .where(
      and(
        eq(conflictsTable.orgId, scope.orgId),
        eq(conflictsTable.brainId, scope.brainId),
        eq(conflictsTable.fingerprint, fingerprint),
        inArray(conflictsTable.status, ["pending", "applying"])
      )
    )
    .limit(1);
  return row ? parseConflictRow(row) : null;
}

export async function enqueuePair(
  scope: ConflictScope,
  c: Contradiction,
  via: "ingest" | "query"
): Promise<EnqueueResult> {
  const incoming = {
    left: c.left.canonicalHash,
    right: c.right.canonicalHash,
  };
  const [pin, open] = await Promise.all([
    getPin(scope, c.fingerprint),
    getOpenByFingerprint(scope, c.fingerprint),
  ]);
  const decision = decideEnqueue({
    incoming,
    open: open
      ? {
          id: open.id,
          hashes: {
            left: open.left.canonicalHash,
            right: open.right.canonicalHash,
          },
        }
      : null,
    pin: pin ? { hashes: pin.hashes } : null,
  });
  if (decision.kind === "skip") {
    return { kind: "skipped", reason: decision.reason };
  }
  if (decision.kind === "bump") {
    const [row] = await requireDb()
      .update(conflictsTable)
      .set({
        leftSide: c.left,
        rightSide: c.right,
        rationale: c.rationale,
        title: c.title,
        proposedLoserBody: c.proposedLoserBody,
        occurrenceCount: sql`${conflictsTable.occurrenceCount} + 1`,
        lastDetectedVia: via,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(conflictsTable.id, decision.id),
          eq(conflictsTable.orgId, scope.orgId),
          eq(conflictsTable.brainId, scope.brainId)
        )
      )
      .returning();
    if (!row) return { kind: "skipped", reason: "pending-unchanged" };
    return { kind: "bumped", id: row.id, occurrenceCount: row.occurrenceCount };
  }

  const [row] = await requireDb()
    .insert(conflictsTable)
    .values({
      orgId: scope.orgId,
      brainId: scope.brainId,
      status: "pending",
      fingerprint: c.fingerprint,
      topic: c.topic,
      title: c.title,
      rationale: c.rationale,
      leftSide: c.left,
      rightSide: c.right,
      proposedLoserBody: c.proposedLoserBody,
      occurrenceCount: 1,
      lastDetectedVia: via,
    })
    .onConflictDoUpdate({
      target: [
        conflictsTable.orgId,
        conflictsTable.brainId,
        conflictsTable.fingerprint,
      ],
      targetWhere: sql`${conflictsTable.status} in ('pending', 'applying')`,
      set: {
        leftSide: c.left,
        rightSide: c.right,
        rationale: c.rationale,
        title: c.title,
        proposedLoserBody: c.proposedLoserBody,
        occurrenceCount: sql`${conflictsTable.occurrenceCount} + 1`,
        lastDetectedVia: via,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) return { kind: "skipped", reason: "pending-unchanged" };
  if (row.occurrenceCount > 1) {
    return { kind: "bumped", id: row.id, occurrenceCount: row.occurrenceCount };
  }
  return { kind: "inserted", id: row.id };
}

export async function listConflictRows(
  scope: ConflictScope,
  status: ListStatus
): Promise<Conflict[]> {
  const where =
    status === "all"
      ? and(
          eq(conflictsTable.orgId, scope.orgId),
          eq(conflictsTable.brainId, scope.brainId)
        )
      : status === "pending"
        ? and(
            eq(conflictsTable.orgId, scope.orgId),
            eq(conflictsTable.brainId, scope.brainId),
            inArray(conflictsTable.status, ["pending", "applying"])
          )
        : and(
            eq(conflictsTable.orgId, scope.orgId),
            eq(conflictsTable.brainId, scope.brainId),
            eq(conflictsTable.status, status)
          );
  const rows = await requireDb()
    .select()
    .from(conflictsTable)
    .where(where)
    .orderBy(desc(conflictsTable.createdAt));
  return rows.map((row) => parseConflictRow(row));
}

export async function getConflictRow(
  scope: ConflictScope,
  id: ConflictId
): Promise<Conflict | null> {
  const [row] = await requireDb()
    .select()
    .from(conflictsTable)
    .where(
      and(
        eq(conflictsTable.orgId, scope.orgId),
        eq(conflictsTable.brainId, scope.brainId),
        eq(conflictsTable.id, id)
      )
    )
    .limit(1);
  return row ? parseConflictRow(row) : null;
}

export async function casPendingToApplying(
  scope: ConflictScope,
  id: ConflictId
): Promise<Conflict> {
  const [row] = await requireDb()
    .update(conflictsTable)
    .set({
      status: "applying",
      lastError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(conflictsTable.orgId, scope.orgId),
        eq(conflictsTable.brainId, scope.brainId),
        eq(conflictsTable.id, id),
        eq(conflictsTable.status, "pending")
      )
    )
    .returning();
  if (!row) {
    const existing = await getConflictRow(scope, id);
    if (!existing) throw new ConflictFailure({ kind: "not-found" });
    throw new ConflictFailure({ kind: "not-pending" });
  }
  return parseConflictRow(row);
}

export async function casApplyingToAccepted(
  scope: ConflictScope,
  id: ConflictId,
  resolution: Resolution,
  apply: ApplyRecord,
  actor: Actor
): Promise<Conflict> {
  const [row] = await requireDb()
    .update(conflictsTable)
    .set({
      status: "accepted",
      resolution,
      applyRecord: apply,
      reviewedBy: actor.email ?? actor.id,
      reviewedAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(conflictsTable.orgId, scope.orgId),
        eq(conflictsTable.brainId, scope.brainId),
        eq(conflictsTable.id, id),
        eq(conflictsTable.status, "applying")
      )
    )
    .returning();
  if (!row) throw new ConflictFailure({ kind: "not-pending" });
  return parseConflictRow(row);
}

export async function revertApplyingToPending(
  scope: ConflictScope,
  id: ConflictId,
  lastError: string | null
): Promise<void> {
  await requireDb()
    .update(conflictsTable)
    .set({
      status: "pending",
      lastError,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(conflictsTable.orgId, scope.orgId),
        eq(conflictsTable.brainId, scope.brainId),
        eq(conflictsTable.id, id),
        eq(conflictsTable.status, "applying")
      )
    );
}

export async function casPendingToRejected(
  scope: ConflictScope,
  id: ConflictId,
  actor: Actor
): Promise<RejectedConflict> {
  const [row] = await requireDb()
    .update(conflictsTable)
    .set({
      status: "rejected",
      reviewedBy: actor.email ?? actor.id,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(conflictsTable.orgId, scope.orgId),
        eq(conflictsTable.brainId, scope.brainId),
        eq(conflictsTable.id, id),
        eq(conflictsTable.status, "pending")
      )
    )
    .returning();
  if (!row) {
    const existing = await getConflictRow(scope, id);
    if (!existing) throw new ConflictFailure({ kind: "not-found" });
    throw new ConflictFailure({ kind: "not-pending" });
  }
  const parsed = parseConflictRow(row);
  if (parsed.status !== "rejected") {
    throw new ConflictFailure({ kind: "not-pending" });
  }
  return parsed;
}

export async function upsertPin(scope: ConflictScope, pin: Pin): Promise<void> {
  await requireDb()
    .insert(conflictPins)
    .values({
      orgId: scope.orgId,
      brainId: scope.brainId,
      fingerprint: pin.fingerprint,
      outcome: pin.outcome,
      leftKey: pin.leftKey,
      rightKey: pin.rightKey,
      topic: pin.topic,
      hashes: pin.hashes,
      githubBlobShas: pin.githubBlobShas,
      conflictId: pin.conflictId,
      pinnedAt: pin.pinnedAt,
    })
    .onConflictDoUpdate({
      target: [conflictPins.brainId, conflictPins.fingerprint],
      set: {
        orgId: scope.orgId,
        outcome: pin.outcome,
        leftKey: pin.leftKey,
        rightKey: pin.rightKey,
        topic: pin.topic,
        hashes: pin.hashes,
        githubBlobShas: pin.githubBlobShas,
        conflictId: pin.conflictId,
        pinnedAt: pin.pinnedAt,
      },
    });
}

export async function getDocHash(
  scope: ConflictScope,
  key: S3Key
): Promise<ContentHash | null> {
  const [row] = await requireDb()
    .select()
    .from(conflictDocHashes)
    .where(
      and(
        eq(conflictDocHashes.brainId, scope.brainId),
        eq(conflictDocHashes.key, key)
      )
    )
    .limit(1);
  return row?.canonicalHash ?? null;
}

export async function upsertDocHash(
  scope: ConflictScope,
  key: S3Key,
  canonicalHash: ContentHash
): Promise<void> {
  await requireDb()
    .insert(conflictDocHashes)
    .values({
      orgId: scope.orgId,
      brainId: scope.brainId,
      key,
      canonicalHash,
      checkedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [conflictDocHashes.brainId, conflictDocHashes.key],
      set: { canonicalHash, checkedAt: new Date(), orgId: scope.orgId },
    });
}

export async function getBrainHandles(
  scope: ConflictScope
): Promise<{ kbId: string | null; docsBucket: string | null } | null> {
  const [row] = await requireDb()
    .select({
      kbId: brains.kbId,
      docsBucket: brains.docsBucket,
    })
    .from(brains)
    .where(and(eq(brains.orgId, scope.orgId), eq(brains.id, scope.brainId)))
    .limit(1);
  return row ?? null;
}

export async function getBrainByDocsBucket(
  bucket: string
): Promise<ConflictScope | null> {
  const [row] = await requireDb()
    .select({ orgId: brains.orgId, id: brains.id, status: brains.status })
    .from(brains)
    .where(eq(brains.docsBucket, bucket))
    .limit(1);
  if (!row || row.status !== "ready") return null;
  return { orgId: row.orgId, brainId: row.id };
}
