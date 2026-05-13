import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";

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

if (!BRAINS_TABLE && process.env.NODE_ENV !== "test") {
  // Don't crash — local dev without the env var still loads the home page.
  // Routes that need the registry will return a clear 500.
  console.warn("BRAINS_TABLE env var is not set — brain routing will fail.");
}

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" }),
  { marshallOptions: { removeUndefinedValues: true } }
);

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

/** Look up a brain by id. Returns null when missing. */
export async function getBrainById(brainId: string): Promise<BrainConfig | null> {
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
  const brain = await fetchBrain(brainId);
  if (!brain) {
    return {
      ok: false,
      status: 404,
      error: `brain \`${brainId}\` not found`,
    };
  }
  if (brain.status !== "ready") {
    return {
      ok: false,
      status: 409,
      error: `brain \`${brainId}\` is ${brain.status}, not ready`,
    };
  }
  return { ok: true, brain };
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
