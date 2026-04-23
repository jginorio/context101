import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { LambdaClient } from "@aws-sdk/client-lambda";

const region = process.env.AWS_REGION ?? "us-east-1";

export const ddbConnectors = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region }),
  { marshallOptions: { removeUndefinedValues: true } }
);
export const sm = new SecretsManagerClient({ region });
export const lambdaClient = new LambdaClient({ region });

export const CONNECTORS_TABLE = process.env.CONNECTORS_TABLE ?? "";
export const CONNECTOR_SYNC_SHEETS_FN_NAME =
  process.env.CONNECTOR_SYNC_SHEETS_FN_NAME ?? "";
export const GOOGLE_OAUTH_CLIENT_SECRET_ID =
  process.env.GOOGLE_OAUTH_CLIENT_SECRET_ID ?? "";
export const CONNECTOR_TOKEN_SECRET_PREFIX =
  process.env.CONNECTOR_TOKEN_SECRET_PREFIX ?? "context101-connector-";

export type ConnectorStatus =
  | "pending_auth"
  | "connecting"
  | "syncing"
  | "connected"
  | "error";

export type Connector = {
  id: string;
  type: "sheets" | "notion";
  status: ConnectorStatus;
  label: string;
  resource_url: string;
  resource_id: string;
  resource_title?: string;
  token_secret_arn?: string;
  google_account_email?: string;
  item_count?: number;
  last_synced_at?: string;
  last_error?: string;
  last_error_at?: string;
  created_at: string;
  created_by?: string; // Cognito email of the user who added this
};

// ── Google Sheets URL parsing ────────────────────────────────────────

export function parseSheetId(url: string): string | null {
  // Handles:
  //   https://docs.google.com/spreadsheets/d/<ID>/edit?gid=0#gid=0
  //   https://docs.google.com/spreadsheets/d/<ID>
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,})/);
  return m ? m[1] : null;
}
