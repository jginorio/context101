import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { and, eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";

import { getAuth } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { brains as postgresBrains } from "@/lib/db/schema";

/**
 * Server-side brain registry helpers.
 *
 * All SSR routes and server components that touch brain-scoped data
 * (files, suggestions, wiki, connectors) resolve the active brain
 * through this module. Single source of truth for:
 *
 *   - Which brain a request is operating on (`resolveBrainFromRequest`)
 *   - The per-brain resource handles (bucket, KB id, tables)
 *   - The default fallback when nothing identifies a brain
 *
 * The provider for the client side (header switcher, URL updates) lives
 * in `lib/brain-context.tsx`.
 */

export const COOKIE_NAME = "ctx_brain";
export const QUERY_PARAM = "brain";
export const HEADER_NAME = "x-brain-id";
export const DEFAULT_BRAIN_ID = "default";

export type BrainStatus = "provisioning" | "ready" | "error" | "deleting";

export type BrainConfig = {
  brain_id: string;
  display_name: string;
  description?: string | null;
  status: BrainStatus;
  created_at: string;
  created_by_email?: string | null;
  error_msg?: string | null;
  // Resource handles — populated once status = "ready".
  kb_id?: string;
  ds_id?: string;
  docs_bucket?: string;
  vector_index_arn?: string;
  suggestions_table?: string;
  connectors_table?: string;
  token_secret_arn?: string;
};

const BRAINS_TABLE = process.env.BRAINS_TABLE ?? "";
const NAME_PREFIX = "context101";

if (!BRAINS_TABLE && process.env.NODE_ENV !== "test") {
  // Don't crash — local dev without the env var still loads the home page.
  // Routes that need the registry will return a clear 500.
  console.warn("BRAINS_TABLE env var is not set — brain routing will fail.");
}

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" }),
  { marshallOptions: { removeUndefinedValues: true } }
);

type BetterAuthSession = {
  user?: {
    id?: string;
    email?: string;
  };
  session?: {
    activeOrganizationId?: string | null;
  };
} | null;

export type AuthContext = {
  orgId: string;
  userId: string;
  userEmail: string | null;
};

/**
 * Resolve the signed-in user's organization + identity from the Better Auth
 * session. Returns null when there's no session, no active org, or no
 * Postgres control plane configured. Routes that write org-scoped rows
 * (connectors, suggestions) use this for `org_id` / `created_by`.
 */
export async function readAuthContext(
  request: NextRequest
): Promise<AuthContext | null> {
  if (!db) return null;
  const session = (await getAuth()
    .api.getSession({ headers: request.headers })
    .catch(() => null)) as BetterAuthSession;
  const orgId = session?.session?.activeOrganizationId ?? null;
  const userId = session?.user?.id ?? null;
  if (!orgId || !userId) return null;
  return { orgId, userId, userEmail: session?.user?.email ?? null };
}

function legacySuggestionsTableForBrainId(brainId: string): string {
  return brainId === DEFAULT_BRAIN_ID
    ? `${NAME_PREFIX}-suggestions`
    : `${NAME_PREFIX}-brain-${brainId}-suggestions`;
}

function legacyConnectorsTableForBrainId(brainId: string): string {
  return brainId === DEFAULT_BRAIN_ID
    ? `${NAME_PREFIX}-connectors`
    : `${NAME_PREFIX}-brain-${brainId}-connectors`;
}

function dateString(value: Date | string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date ? value.toISOString() : value;
}

async function readBetterAuthOrgId(request: NextRequest): Promise<string | null> {
  if (!db) return null;
  const session = (await getAuth()
    .api.getSession({
      headers: request.headers,
    })
    .catch(() => null)) as BetterAuthSession;
  return session?.session?.activeOrganizationId ?? null;
}

type PostgresBrainRow = typeof postgresBrains.$inferSelect;

function mapPostgresBrain(row: PostgresBrainRow): BrainConfig {
  return {
    brain_id: row.id,
    display_name: row.displayName,
    description: row.description,
    status: row.status,
    created_at: dateString(row.createdAt),
    created_by_email: null,
    error_msg: row.errorMsg,
    kb_id: row.kbId ?? undefined,
    ds_id: row.dsId ?? undefined,
    docs_bucket: row.docsBucket ?? undefined,
    vector_index_arn: row.vectorIndexArn ?? undefined,
    // Legacy per-brain DDB table names are retained on the shape only for
    // backwards compatibility; connectors/suggestions now live in Postgres
    // keyed by brain_id, so these are no longer used to address storage.
    suggestions_table: legacySuggestionsTableForBrainId(row.id),
    connectors_table: legacyConnectorsTableForBrainId(row.id),
    token_secret_arn: row.tokenSecretArn ?? undefined,
  };
}

async function fetchBrainFromPostgres(
  brainId: string,
  orgId: string
): Promise<BrainConfig | null> {
  if (!db) return null;

  const [row] = await db
    .select()
    .from(postgresBrains)
    .where(and(eq(postgresBrains.orgId, orgId), eq(postgresBrains.id, brainId)))
    .limit(1);

  if (!row) return null;
  return mapPostgresBrain(row);
}

/**
 * Look up a brain by id from Postgres without an org filter. Used by routes
 * that have no org context in hand (the OAuth callback and the MCP token
 * route). The connection role bypasses RLS, so this is an id-only lookup.
 */
async function fetchBrainByIdFromPostgres(
  brainId: string
): Promise<BrainConfig | null> {
  if (!db) return null;
  const [row] = await db
    .select()
    .from(postgresBrains)
    .where(eq(postgresBrains.id, brainId))
    .limit(1);
  if (!row) return null;
  return mapPostgresBrain(row);
}

// Process-local cache. SSR Lambda containers are reused across invocations
// so this avoids re-reading the registry on every request. TTL is short
// enough that newly-provisioned brains show up within a minute without a
// redeploy or container recycle.
const TTL_MS = 30_000;
const cache = new Map<string, { item: BrainConfig | null; loadedAt: number }>();

async function fetchBrain(brainId: string): Promise<BrainConfig | null> {
  const now = Date.now();
  const cached = cache.get(brainId);
  if (cached && now - cached.loadedAt < TTL_MS) return cached.item;

  if (!BRAINS_TABLE) return null;
  const res = await ddb.send(
    new GetCommand({ TableName: BRAINS_TABLE, Key: { brain_id: brainId } })
  );
  const item = (res.Item ?? null) as BrainConfig | null;
  cache.set(brainId, { item, loadedAt: now });
  return item;
}

/**
 * Look up a brain by id. Returns null when missing. Prefers the Postgres
 * control plane (the source of truth); falls back to the legacy DynamoDB
 * registry only when Postgres isn't configured or has no matching row.
 */
export async function getBrainById(brainId: string): Promise<BrainConfig | null> {
  if (db) {
    const pg = await fetchBrainByIdFromPostgres(brainId);
    if (pg) return pg;
  }
  return fetchBrain(brainId);
}

/** List every brain in the registry (across all statuses). Sorted by created_at desc. */
export async function listAllBrains(): Promise<BrainConfig[]> {
  if (!BRAINS_TABLE) return [];
  // Query each status partition via the GSI. We avoid a Scan to keep cost
  // and latency predictable as the registry grows.
  const statuses: BrainStatus[] = ["ready", "provisioning", "error", "deleting"];
  const all: BrainConfig[] = [];
  for (const status of statuses) {
    const res = await ddb.send(
      new QueryCommand({
        TableName: BRAINS_TABLE,
        IndexName: "status-created_at-index",
        KeyConditionExpression: "#s = :s",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":s": status },
        ScanIndexForward: false,
      })
    );
    for (const it of (res.Items ?? []) as BrainConfig[]) all.push(it);
  }
  // Already partitioned by status; sort the combined list by created_at
  // desc so the freshest brains (including provisioning) come first.
  all.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  return all;
}

/** List only brains in `ready` status — what the UI switcher shows. */
export async function listReadyBrains(): Promise<BrainConfig[]> {
  if (!BRAINS_TABLE) return [];
  const res = await ddb.send(
    new QueryCommand({
      TableName: BRAINS_TABLE,
      IndexName: "status-created_at-index",
      KeyConditionExpression: "#s = :s",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":s": "ready" },
      ScanIndexForward: false,
    })
  );
  return (res.Items ?? []) as BrainConfig[];
}

/**
 * Pull the requested brain id off a request:
 *   ?brain=<id>  →  x-brain-id header  →  ctx_brain cookie  →  "default"
 *
 * Returns the *id only*, not the resolved row — callers may want to
 * decide what to do with an unknown id before doing a DDB lookup.
 */
export async function readRequestedBrainId(request: NextRequest): Promise<string> {
  const fromQuery = request.nextUrl.searchParams.get(QUERY_PARAM);
  if (fromQuery) return fromQuery;
  const fromHeader = request.headers.get(HEADER_NAME);
  if (fromHeader) return fromHeader;
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(COOKIE_NAME)?.value;
  if (fromCookie) return fromCookie;
  return DEFAULT_BRAIN_ID;
}

/** Same logic for server components that don't have a NextRequest in hand. */
export async function readRequestedBrainIdFromHeaders(): Promise<string> {
  const hdrs = await headers();
  const fromHeader = hdrs.get(HEADER_NAME);
  if (fromHeader) return fromHeader;
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(COOKIE_NAME)?.value;
  if (fromCookie) return fromCookie;
  return DEFAULT_BRAIN_ID;
}

export type ResolveResult =
  | { ok: true; brain: BrainConfig }
  | { ok: false; status: number; error: string };

/**
 * Resolve the active brain for a route. Returns the full registry row
 * with all handles, or an error shape the route can hand back as a JSON
 * response. Refuses brains that aren't in `ready` status — actions on a
 * still-provisioning or errored brain shouldn't appear to succeed.
 */
export async function resolveBrainFromRequest(
  request: NextRequest
): Promise<ResolveResult> {
  const brainId = await readRequestedBrainId(request);
  const orgId = await readBetterAuthOrgId(request);
  const brain = orgId
    ? await fetchBrainFromPostgres(brainId, orgId)
    : await fetchBrain(brainId);

  // Better Auth/Postgres deployments should not fall through to the legacy
  // global DDB registry when a user is signed in to an org. That would leak
  // cross-org brains. Only use DDB when no Better Auth org context exists.
  if (!brain && orgId) {
    return {
      ok: false,
      status: 404,
      error: `brain \`${brainId}\` not found`,
    };
  }

  const resolvedBrain = brain ?? (await fetchBrain(brainId));
  if (!resolvedBrain) {
    return {
      ok: false,
      status: 404,
      error: `brain \`${brainId}\` not found`,
    };
  }
  if (resolvedBrain.status !== "ready") {
    return {
      ok: false,
      status: 409,
      error: `brain \`${brainId}\` is ${resolvedBrain.status}, not ready`,
    };
  }
  return { ok: true, brain: resolvedBrain };
}

/** Strip server-only fields from a brain row before returning it client-side. */
export function publicBrain(brain: BrainConfig) {
  return {
    brain_id: brain.brain_id,
    display_name: brain.display_name,
    description: brain.description ?? null,
    status: brain.status,
    created_at: brain.created_at,
    created_by_email: brain.created_by_email ?? null,
    error_msg: brain.error_msg ?? null,
    // Resource handles are NOT exposed client-side. The UI only needs the
    // id + display name; SSR routes look up the rest by id.
  };
}

export type PublicBrain = ReturnType<typeof publicBrain>;
