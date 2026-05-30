import { and, desc, eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";

import { getAuth } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { brains as postgresBrains } from "@/lib/db/schema";
import { member } from "@/lib/db/auth-schema";

/**
 * Server-side brain registry helpers.
 *
 * All SSR routes and server components that touch brain-scoped data
 * (files, suggestions, wiki, connectors) resolve the active brain through
 * this module against the Postgres control plane (the single source of
 * truth). Brains are org-scoped; the active org comes from the Better Auth
 * session.
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
  token_secret_arn?: string;
};

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

function requireDb() {
  if (!db) throw new Error("DATABASE_URL is not configured");
  return db;
}

async function getSession(request: NextRequest): Promise<BetterAuthSession> {
  if (!db) return null;
  return (await getAuth()
    .api.getSession({ headers: request.headers })
    .catch(() => null)) as BetterAuthSession;
}

/**
 * True if `userId` is currently a member of `orgId`.
 *
 * Better Auth's `removeMember` deletes the membership row but does NOT
 * revoke the user's existing session or clear `activeOrganizationId` on it.
 * So we re-verify membership on every request rather than trusting the
 * session's `activeOrganizationId` — otherwise a just-removed user keeps
 * org-scoped access until their session expires.
 */
async function isOrgMember(userId: string, orgId: string): Promise<boolean> {
  if (!db) return false;
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
    .limit(1);
  return !!row;
}

/**
 * Resolve the signed-in user's organization + identity from the Better Auth
 * session, verifying they are still a member of the active org. Returns null
 * when there's no session, no active org, or the user is no longer a member.
 * Routes that read/write org-scoped rows use this for `org_id` / `created_by`.
 */
export async function readAuthContext(
  request: NextRequest
): Promise<AuthContext | null> {
  const session = await getSession(request);
  const orgId = session?.session?.activeOrganizationId ?? null;
  const userId = session?.user?.id ?? null;
  if (!orgId || !userId) return null;
  if (!(await isOrgMember(userId, orgId))) return null;
  return { orgId, userId, userEmail: session?.user?.email ?? null };
}

function dateString(value: Date | string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date ? value.toISOString() : value;
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
    token_secret_arn: row.tokenSecretArn ?? undefined,
  };
}

async function fetchBrainFromPostgres(
  brainId: string,
  orgId: string
): Promise<BrainConfig | null> {
  const [row] = await requireDb()
    .select()
    .from(postgresBrains)
    .where(and(eq(postgresBrains.orgId, orgId), eq(postgresBrains.id, brainId)))
    .limit(1);
  return row ? mapPostgresBrain(row) : null;
}

/**
 * Look up a brain by id scoped to an org. Use this for org-scoped routes
 * (e.g. the MCP token route) so a non-member can't read another org's brain.
 */
export async function getBrainByIdForOrg(
  orgId: string,
  brainId: string
): Promise<BrainConfig | null> {
  return fetchBrainFromPostgres(brainId, orgId);
}

/**
 * Look up a brain by id without an org filter. Used only by the OAuth
 * callback, which routes via the opaque `state` param and has no reliable
 * org context. The connection role bypasses RLS, so this is an id-only lookup.
 */
export async function getBrainById(brainId: string): Promise<BrainConfig | null> {
  const [row] = await requireDb()
    .select()
    .from(postgresBrains)
    .where(eq(postgresBrains.id, brainId))
    .limit(1);
  return row ? mapPostgresBrain(row) : null;
}

/** List every brain for an org (all statuses), newest first. */
export async function listBrainsForOrg(orgId: string): Promise<BrainConfig[]> {
  const rows = await requireDb()
    .select()
    .from(postgresBrains)
    .where(eq(postgresBrains.orgId, orgId))
    .orderBy(desc(postgresBrains.createdAt));
  return rows.map(mapPostgresBrain);
}

/** List only `ready` brains for an org — what the UI switcher shows. */
export async function listReadyBrainsForOrg(
  orgId: string
): Promise<BrainConfig[]> {
  const rows = await requireDb()
    .select()
    .from(postgresBrains)
    .where(
      and(eq(postgresBrains.orgId, orgId), eq(postgresBrains.status, "ready"))
    )
    .orderBy(desc(postgresBrains.createdAt));
  return rows.map(mapPostgresBrain);
}

/**
 * Pull the requested brain id off a request:
 *   ?brain=<id>  →  x-brain-id header  →  ctx_brain cookie  →  "default"
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
 * Resolve the active brain for a route. Returns the full registry row with
 * all handles, or an error shape the route can hand back as a JSON response.
 * Requires an authenticated org (brains are org-scoped) and refuses brains
 * that aren't `ready` — actions on a still-provisioning or errored brain
 * shouldn't appear to succeed.
 */
export async function resolveBrainFromRequest(
  request: NextRequest
): Promise<ResolveResult> {
  const auth = await readAuthContext(request);
  if (!auth) {
    return { ok: false, status: 401, error: "not authenticated" };
  }
  const brainId = await readRequestedBrainId(request);

  const brain = await fetchBrainFromPostgres(brainId, auth.orgId);
  if (!brain) {
    return { ok: false, status: 404, error: `brain \`${brainId}\` not found` };
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
