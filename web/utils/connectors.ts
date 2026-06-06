import {
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { connectors as connectorsSchema } from "@/lib/db/schema";

const region = process.env.AWS_REGION ?? "us-east-1";

export const sm = new SecretsManagerClient({ region });
export const lambdaClient = new LambdaClient({ region });

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
  | "error"
  | "paused";

export type ConnectorType =
  | "sheets"
  | "docs"
  | "slides"
  | "notion"
  | "github";

// Notion page hierarchy captured by the sync (for the Notion-style sidebar).
export type NotionTreeNode = {
  id: string;
  title: string;
  key: string | null; // S3 key of the page's .md (null for a database root)
  icon: { type: "emoji" | "url"; value: string } | null;
  children: NotionTreeNode[];
};

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
  notion_tree?: NotionTreeNode;
  github_account_login?: string;
  item_count?: number;
  last_synced_at?: string;
  last_error?: string;
  last_error_at?: string;
  created_at: string;
  created_by?: string; // email (or user id) of the user who added this
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

// ── Postgres connector store ─────────────────────────────────────────
// Connectors live in the `connectors` table (control-plane source of
// truth shared with the sync Lambdas). Rows are addressed by (org_id,
// brain_id); provider-specific identity (resource_title, account email,
// workspace name, github login) lives in the `metadata` jsonb.

type ConnectorRow = typeof connectorsSchema.$inferSelect;
type ConnectorMetadata = Record<string, unknown>;

function requireDb() {
  if (!db) throw new Error("DATABASE_URL is not configured");
  return db;
}

function metaString(meta: ConnectorMetadata, key: string): string | undefined {
  const v = meta[key];
  return typeof v === "string" ? v : undefined;
}

/** Map a Postgres connectors row into the client-facing Connector shape. */
export function toClientConnector(row: ConnectorRow): Connector {
  const meta = (row.metadata ?? {}) as ConnectorMetadata;
  return {
    id: row.id,
    type: row.type as ConnectorType,
    status: row.status as ConnectorStatus,
    label: row.label,
    resource_url: row.externalUrl ?? "",
    resource_id: row.externalId ?? "",
    resource_title: metaString(meta, "resource_title"),
    token_secret_arn: row.tokenSecretArn ?? undefined,
    google_account_email: metaString(meta, "google_account_email"),
    notion_workspace_name: metaString(meta, "notion_workspace_name"),
    notion_tree: (meta.notion_tree as NotionTreeNode | undefined) ?? undefined,
    github_account_login: metaString(meta, "github_account_login"),
    item_count: row.itemCount ?? undefined,
    last_synced_at: row.lastSyncedAt
      ? row.lastSyncedAt.toISOString()
      : undefined,
    last_error: row.lastError ?? undefined,
    created_at: row.createdAt.toISOString(),
    created_by: row.createdBy ?? undefined,
    brain_id: row.brainId,
  };
}

export async function pgListConnectors(
  orgId: string,
  brainId: string
): Promise<ConnectorRow[]> {
  return requireDb()
    .select()
    .from(connectorsSchema)
    .where(
      and(
        eq(connectorsSchema.orgId, orgId),
        eq(connectorsSchema.brainId, brainId)
      )
    )
    .orderBy(desc(connectorsSchema.createdAt));
}

/**
 * Fetch a connector by id alone (no org/brain filter). Used by the OAuth
 * callback, which routes via the opaque `state` param and has no reliable
 * org context. Connector ids are UUIDs and the connection role bypasses
 * RLS, so an id lookup is safe here.
 */
export async function pgGetConnectorById(
  id: string
): Promise<ConnectorRow | null> {
  const [row] = await requireDb()
    .select()
    .from(connectorsSchema)
    .where(eq(connectorsSchema.id, id))
    .limit(1);
  return row ?? null;
}

export async function pgGetConnector(
  orgId: string,
  brainId: string,
  id: string
): Promise<ConnectorRow | null> {
  const [row] = await requireDb()
    .select()
    .from(connectorsSchema)
    .where(
      and(
        eq(connectorsSchema.orgId, orgId),
        eq(connectorsSchema.brainId, brainId),
        eq(connectorsSchema.id, id)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function pgInsertConnector(input: {
  orgId: string;
  brainId: string;
  type: ConnectorType;
  label: string;
  externalUrl: string;
  externalId: string;
  createdBy: string;
}): Promise<ConnectorRow> {
  const [row] = await requireDb()
    .insert(connectorsSchema)
    .values({
      orgId: input.orgId,
      brainId: input.brainId,
      type: input.type,
      label: input.label,
      externalUrl: input.externalUrl,
      externalId: input.externalId,
      status: "pending_auth",
      createdBy: input.createdBy,
    })
    .returning();
  return row;
}

// The persisted status values (the `source_status` Postgres enum). The
// client-facing ConnectorStatus also has a transient "connecting" state
// that is never written to the database.
type DbConnectorStatus =
  | "pending_auth"
  | "syncing"
  | "connected"
  | "error"
  | "paused";

/** Patch a connector row by id (org/brain scoped). */
export async function pgUpdateConnector(
  orgId: string,
  brainId: string,
  id: string,
  patch: Partial<{
    status: DbConnectorStatus;
    tokenSecretArn: string;
    metadata: ConnectorMetadata;
  }>
): Promise<void> {
  await requireDb()
    .update(connectorsSchema)
    .set({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.tokenSecretArn
        ? { tokenSecretArn: patch.tokenSecretArn }
        : {}),
      ...(patch.metadata ? { metadata: patch.metadata } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(connectorsSchema.orgId, orgId),
        eq(connectorsSchema.brainId, brainId),
        eq(connectorsSchema.id, id)
      )
    );
}

export async function pgDeleteConnector(
  orgId: string,
  brainId: string,
  id: string
): Promise<void> {
  await requireDb()
    .delete(connectorsSchema)
    .where(
      and(
        eq(connectorsSchema.orgId, orgId),
        eq(connectorsSchema.brainId, brainId),
        eq(connectorsSchema.id, id)
      )
    );
}
