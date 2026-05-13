import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { BrainConfig } from "@/lib/brains-server";

/**
 * Shared DynamoDB doc client for suggestions tables.
 *
 * Local dev: uses AWS_PROFILE from .env.local.
 * Amplify SSR: uses the compute role's credentials automatically.
 *
 * Each brain has its own per-brain suggestions table (created at runtime
 * by the brain-provisioner Lambda). Routes resolve the active brain via
 * `resolveBrainFromRequest` and call `suggestionsTableForBrain(brain)` to
 * pick the right table name.
 *
 * `SUGGESTIONS_TABLE` is the default brain's table name baked at build
 * time. Retained as a fallback for unmigrated routes; remove once
 * everything routes through a resolved brain.
 */

export const SUGGESTIONS_TABLE = process.env.SUGGESTIONS_TABLE ?? "";

const rawClient = new DynamoDBClient({
  region: process.env.AWS_REGION ?? "us-east-1",
});

export const ddb = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

export type Suggestion = {
  id: string;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
  title: string;
  content: string;
  target_path?: string;
  rationale?: string;
  trigger?: string;
  reviewed_at?: string;
  reviewer_email?: string;
};

/** Pull the suggestions table name out of a resolved brain row. */
export function suggestionsTableForBrain(brain: BrainConfig): string {
  const t = brain.suggestions_table;
  if (!t) {
    throw new Error(
      `brain \`${brain.brain_id}\` has no suggestions_table on its registry row`
    );
  }
  return t;
}
