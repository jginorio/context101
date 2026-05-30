import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { suggestions as suggestionsSchema } from "@/lib/db/schema";

/**
 * Suggestions store.
 *
 * Suggestions live in the Postgres `suggestions` table — the same table
 * the MCP server writes to via `suggest_knowledge`. Rows are org-scoped
 * and addressed by brain_id; the web admin lists / approves / rejects them.
 */

export type SuggestionStatus = "pending" | "accepted" | "rejected";

export type Suggestion = {
  id: string;
  status: SuggestionStatus;
  created_at: string;
  title: string;
  content: string;
  target_path?: string;
  rationale?: string;
  trigger?: string;
  reviewed_at?: string;
  reviewer_email?: string;
};

type SuggestionRow = typeof suggestionsSchema.$inferSelect;

function requireDb() {
  if (!db) throw new Error("DATABASE_URL is not configured");
  return db;
}

/** Map a Postgres suggestions row into the client-facing shape. */
export function toClientSuggestion(row: SuggestionRow): Suggestion {
  return {
    id: row.id,
    status: row.status as SuggestionStatus,
    created_at: row.createdAt.toISOString(),
    title: row.title,
    content: row.content,
    target_path: row.targetPath ?? undefined,
    rationale: row.rationale ?? undefined,
    trigger: row.trigger ?? undefined,
    reviewed_at: row.reviewedAt ? row.reviewedAt.toISOString() : undefined,
    reviewer_email: row.reviewedBy ?? undefined,
  };
}

export async function pgListSuggestions(
  orgId: string,
  brainId: string,
  status?: SuggestionStatus
): Promise<SuggestionRow[]> {
  const where = status
    ? and(
        eq(suggestionsSchema.orgId, orgId),
        eq(suggestionsSchema.brainId, brainId),
        eq(suggestionsSchema.status, status)
      )
    : and(
        eq(suggestionsSchema.orgId, orgId),
        eq(suggestionsSchema.brainId, brainId)
      );
  return requireDb()
    .select()
    .from(suggestionsSchema)
    .where(where)
    .orderBy(desc(suggestionsSchema.createdAt));
}

export async function pgGetSuggestion(
  orgId: string,
  brainId: string,
  id: string
): Promise<SuggestionRow | null> {
  const [row] = await requireDb()
    .select()
    .from(suggestionsSchema)
    .where(
      and(
        eq(suggestionsSchema.orgId, orgId),
        eq(suggestionsSchema.brainId, brainId),
        eq(suggestionsSchema.id, id)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function pgMarkSuggestionAccepted(
  orgId: string,
  brainId: string,
  id: string,
  finalPath: string,
  reviewedBy: string | null
): Promise<void> {
  await requireDb()
    .update(suggestionsSchema)
    .set({
      status: "accepted",
      finalPath,
      reviewedBy,
      reviewedAt: new Date(),
    })
    .where(
      and(
        eq(suggestionsSchema.orgId, orgId),
        eq(suggestionsSchema.brainId, brainId),
        eq(suggestionsSchema.id, id)
      )
    );
}

/**
 * Flip a pending suggestion to rejected. Returns false if the row wasn't
 * pending (already reviewed) — callers map that to a 409.
 */
export async function pgMarkSuggestionRejected(
  orgId: string,
  brainId: string,
  id: string,
  reviewedBy: string | null
): Promise<boolean> {
  const updated = await requireDb()
    .update(suggestionsSchema)
    .set({ status: "rejected", reviewedBy, reviewedAt: new Date() })
    .where(
      and(
        eq(suggestionsSchema.orgId, orgId),
        eq(suggestionsSchema.brainId, brainId),
        eq(suggestionsSchema.id, id),
        eq(suggestionsSchema.status, "pending")
      )
    )
    .returning();
  return updated.length > 0;
}
