import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { LambdaClient } from "@aws-sdk/client-lambda";

import type { BrainConfig } from "@/lib/brains-server";

const region = process.env.AWS_REGION ?? "us-east-1";

export const ddbConnectors = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region }),
  { marshallOptions: { removeUndefinedValues: true } }
);
export const sm = new SecretsManagerClient({ region });
export const lambdaClient = new LambdaClient({ region });

/** Default brain's connectors table — fallback for unmigrated callers. */
export const CONNECTORS_TABLE = process.env.CONNECTORS_TABLE ?? "";

/** Pull the connectors table name out of a resolved brain row. */
export function connectorsTableForBrain(brain: BrainConfig): string {
  const t = brain.connectors_table;
  if (!t) {
    throw new Error(
      `brain \`${brain.brain_id}\` has no connectors_table on its registry row`
    );
  }
  return t;
}
export const CONNECTOR_SYNC_SHEETS_FN_NAME =
  process.env.CONNECTOR_SYNC_SHEETS_FN_NAME ?? "";
export const CONNECTOR_SYNC_DOCS_FN_NAME =
  process.env.CONNECTOR_SYNC_DOCS_FN_NAME ?? "";
export const CONNECTOR_SYNC_SLIDES_FN_NAME =
  process.env.CONNECTOR_SYNC_SLIDES_FN_NAME ?? "";
export const CONNECTOR_SYNC_NOTION_FN_NAME =
  process.env.CONNECTOR_SYNC_NOTION_FN_NAME ?? "";
export const CONNECTOR_SYNC_GITHUB_FN_NAME =
  process.env.CONNECTOR_SYNC_GITHUB_FN_NAME ?? "";
export const GOOGLE_OAUTH_CLIENT_SECRET_ID =
  process.env.GOOGLE_OAUTH_CLIENT_SECRET_ID ?? "";
export const NOTION_OAUTH_CLIENT_SECRET_ID =
  process.env.NOTION_OAUTH_CLIENT_SECRET_ID ?? "";
export const CONNECTOR_TOKEN_SECRET_PREFIX =
  process.env.CONNECTOR_TOKEN_SECRET_PREFIX ?? "context101-connector-";

export type ConnectorStatus =
  | "pending_auth"
  | "connecting"
  | "syncing"
  | "connected"
  | "error";

export type ConnectorType =
  | "sheets"
  | "docs"
  | "slides"
  | "notion"
  | "github";

export type Connector = {
  id: string;
  type: ConnectorType;
  status: ConnectorStatus;
  label: string;
  resource_url: string;
  resource_id: string;
  resource_title?: string;
  token_secret_arn?: string;
  google_account_email?: string;
  notion_workspace_name?: string;
  github_account_login?: string;
  item_count?: number;
  last_synced_at?: string;
  last_error?: string;
  last_error_at?: string;
  created_at: string;
  created_by?: string; // Cognito email of the user who added this
  // Set on create — the brain this connector belongs to. Stored on the
  // row so dispatchers / sync Lambdas can route into the right brain
  // without re-reading the registry. Each brain has its own connectors
  // table, so this is mostly belt-and-suspenders, but it also helps when
  // debugging cross-brain issues.
  brain_id?: string;
};

// ── Google resource URL parsing ──────────────────────────────────────

export function parseSheetId(url: string): string | null {
  // https://docs.google.com/spreadsheets/d/<ID>/edit?gid=0#gid=0
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,})/);
  return m ? m[1] : null;
}

export function parseDocId(url: string): string | null {
  // https://docs.google.com/document/d/<ID>/edit
  const m = url.match(/\/document\/d\/([a-zA-Z0-9_-]{10,})/);
  return m ? m[1] : null;
}

export function parseSlidesId(url: string): string | null {
  // https://docs.google.com/presentation/d/<ID>/edit
  const m = url.match(/\/presentation\/d\/([a-zA-Z0-9_-]{10,})/);
  return m ? m[1] : null;
}

/**
 * Parse a GitHub URL into "owner/repo". Accepts:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo/tree/main/...
 *   git@github.com:owner/repo.git
 *   owner/repo  (raw)
 */
export function parseGithubRepo(url: string): string | null {
  const trimmed = url.trim();
  // raw owner/repo form
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) return trimmed;
  // https
  const m = trimmed.match(
    /github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/?#]|$)/
  );
  if (m) return `${m[1]}/${m[2]}`;
  return null;
}

export function parseNotionId(url: string): string | null {
  // Notion page/database URLs end with a 32-char hex id (optionally dashed):
  //   https://www.notion.so/workspace/Page-Title-abc123…def
  //   https://www.notion.so/abc123def?v=…   (database)
  //   https://www.notion.so/workspace/abc12345-6789-…-…-…
  const dashed = url.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  if (dashed) return dashed[1].replace(/-/g, "");
  const packed = url.match(/([0-9a-f]{32})(?:[?#/]|$)/i);
  return packed ? packed[1] : null;
}

export function parseResourceId(
  type: ConnectorType,
  url: string
): string | null {
  switch (type) {
    case "sheets":
      return parseSheetId(url);
    case "docs":
      return parseDocId(url);
    case "slides":
      return parseSlidesId(url);
    case "notion":
      return parseNotionId(url);
    case "github":
      return parseGithubRepo(url);
    default:
      return null;
  }
}

// Keep the old name as an alias for callers that haven't migrated.
export const parseGoogleResourceId = parseResourceId;

// ── OAuth scopes per connector type ──────────────────────────────────

const COMMON_IDENTITY_SCOPES = ["openid", "email", "profile"];

export function oauthScopesFor(type: ConnectorType): string[] {
  switch (type) {
    case "sheets":
      return [
        "https://www.googleapis.com/auth/spreadsheets.readonly",
        "https://www.googleapis.com/auth/drive.metadata.readonly",
        ...COMMON_IDENTITY_SCOPES,
      ];
    case "docs":
      return [
        "https://www.googleapis.com/auth/documents.readonly",
        "https://www.googleapis.com/auth/drive.metadata.readonly",
        ...COMMON_IDENTITY_SCOPES,
      ];
    case "slides":
      return [
        "https://www.googleapis.com/auth/presentations.readonly",
        "https://www.googleapis.com/auth/drive.metadata.readonly",
        ...COMMON_IDENTITY_SCOPES,
      ];
    default:
      return COMMON_IDENTITY_SCOPES;
  }
}

// Map connector type to its sync-Lambda name env var
export function syncFnNameFor(type: ConnectorType): string {
  switch (type) {
    case "sheets":
      return CONNECTOR_SYNC_SHEETS_FN_NAME;
    case "docs":
      return CONNECTOR_SYNC_DOCS_FN_NAME;
    case "slides":
      return CONNECTOR_SYNC_SLIDES_FN_NAME;
    case "notion":
      return CONNECTOR_SYNC_NOTION_FN_NAME;
    case "github":
      return CONNECTOR_SYNC_GITHUB_FN_NAME;
    default:
      return "";
  }
}

// Is this type authenticated via Google OAuth (vs Notion OAuth vs other)?
export function isGoogleType(type: ConnectorType): boolean {
  return type === "sheets" || type === "docs" || type === "slides";
}
