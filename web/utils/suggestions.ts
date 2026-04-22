import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/**
 * Shared DynamoDB doc client for the Suggestions table.
 *
 * Local dev: uses AWS_PROFILE from .env.local.
 * Amplify SSR: uses the compute role's credentials automatically.
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
