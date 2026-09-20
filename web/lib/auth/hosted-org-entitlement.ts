/**
 * Hosted org soft-lock: gate product use for a canceled org after
 * grace (`periodEnd`), only when `APP_MODE=hosted`.
 *
 * Per-org, not per-user. Other orgs the same member belongs to stay
 * usable. Sessions, members, and data are not deleted here.
 *
 * Metadata is stamped by private hosted Creem webhooks (context101-hosted
 * PR #7) onto Better Auth `organization.metadata` JSON.
 */

import { isHostedDeployment } from "@/lib/deployment/config";

export const HOSTED_ORG_SOFT_LOCKED_CODE = "HOSTED_ORG_SOFT_LOCKED";

export const HOSTED_ORG_SOFT_LOCKED_ERROR =
  "This organization's subscription has ended. Renew to continue.";

/** Storefront checkout. Override with HOSTED_RENEW_URL. No Creem secrets. */
export function hostedRenewUrl(env: NodeJS.Dict<string> = process.env): string {
  const override = env.HOSTED_RENEW_URL?.trim();
  if (override) return override;
  return "https://context101.dev"; // pragma: allowlist secret
}

export type OrgBillingStatus = "active" | "grace" | "revoked";

/**
 * `organization.metadata` contract expected from hosted webhooks.
 *
 * ```json
 * {
 *   "source": "creem-storefront",
 *   "creemCustomerId": "cust_…",
 *   "creemSubscriptionId": "sub_…",
 *   "billingStatus": "active | grace | revoked",
 *   "periodEnd": "ISO from current_period_end_date",
 *   "revokedAt": "ISO, only when locked",
 *   "billingReason": "subscription_scheduled_cancel | subscription_canceled | …"
 * }
 * ```
 *
 * Missing `billingStatus` (today's checkout stamp is just Creem ids) is
 * treated as entitled so unstamped Hosted orgs are not locked.
 */
export type HostedOrgMetadata = {
  source?: string;
  creemCustomerId?: string;
  creemSubscriptionId?: string;
  billingStatus?: OrgBillingStatus;
  periodEnd?: string;
  revokedAt?: string;
  billingReason?: string;
};

export type HostedOrgAccess =
  | { entitled: true }
  | {
      entitled: false;
      code: typeof HOSTED_ORG_SOFT_LOCKED_CODE;
      error: string;
    };

/** Better Auth organization plugin actions that use the locked org. */
export const HOSTED_ORG_LOCKED_PATHS = [
  "/organization/invite-member",
  "/organization/cancel-invitation",
  "/organization/remove-member",
  "/organization/update-member-role",
  "/organization/update",
  "/organization/update-organization",
] as const;

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalBillingStatus(value: unknown): OrgBillingStatus | undefined {
  if (value === "active" || value === "grace" || value === "revoked") {
    return value;
  }
  return undefined;
}

export function parseOrganizationMetadata(
  raw: unknown
): HostedOrgMetadata | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return normalizeMetadata(raw as Record<string, unknown>);
  }
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return normalizeMetadata(parsed as Record<string, unknown>);
  } catch {
    return null;
  }
}

function normalizeMetadata(
  parsed: Record<string, unknown>
): HostedOrgMetadata {
  const meta: HostedOrgMetadata = {};
  const source = optionalString(parsed.source);
  if (source) meta.source = source;
  const creemCustomerId = optionalString(parsed.creemCustomerId);
  if (creemCustomerId) meta.creemCustomerId = creemCustomerId;
  const creemSubscriptionId = optionalString(parsed.creemSubscriptionId);
  if (creemSubscriptionId) meta.creemSubscriptionId = creemSubscriptionId;
  const billingStatus = optionalBillingStatus(parsed.billingStatus);
  if (billingStatus) meta.billingStatus = billingStatus;
  const periodEnd = optionalString(parsed.periodEnd);
  if (periodEnd) meta.periodEnd = periodEnd;
  const revokedAt = optionalString(parsed.revokedAt);
  if (revokedAt) meta.revokedAt = revokedAt;
  const billingReason =
    optionalString(parsed.billingReason) ?? optionalString(parsed.reason);
  if (billingReason) meta.billingReason = billingReason;
  return meta;
}

export function parsePeriodEnd(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

function locked(): HostedOrgAccess {
  return {
    entitled: false,
    code: HOSTED_ORG_SOFT_LOCKED_CODE,
    error: HOSTED_ORG_SOFT_LOCKED_ERROR,
  };
}

/**
 * Given active-org metadata + now, return whether that org may use
 * the product. Gate only when `APP_MODE=hosted` — same rule as hosted
 * storefront PR #7.
 *
 * Entitled: `billingStatus === "active"`, or `"grace"` with `periodEnd`
 * in the future, or missing `billingStatus` (legacy checkout stamp).
 * Soft-locked: `"revoked"`, `"grace"` with `periodEnd` missing/past,
 * or `revokedAt` set when status is not an entitled state.
 */
export function hostedOrgAccess(
  metadata: unknown,
  now: Date = new Date(),
  env: NodeJS.Dict<string> = process.env
): HostedOrgAccess {
  if (!isHostedDeployment(env)) return { entitled: true };

  const meta = parseOrganizationMetadata(metadata);
  const status = meta?.billingStatus;

  if (status === "active") return { entitled: true };

  if (status === "grace") {
    const periodMs = parsePeriodEnd(meta?.periodEnd);
    if (periodMs != null && periodMs > now.getTime()) {
      return { entitled: true };
    }
    return locked();
  }

  if (status === "revoked") return locked();
  if (parsePeriodEnd(meta?.revokedAt) != null) return locked();

  return { entitled: true };
}

export function isHostedOrgEntitled(
  metadata: unknown,
  now: Date = new Date(),
  env: NodeJS.Dict<string> = process.env
): boolean {
  return hostedOrgAccess(metadata, now, env).entitled;
}

export function hostedOrgSoftLockJson(
  access: HostedOrgAccess
): Response | null {
  if (access.entitled) return null;
  return Response.json(
    {
      error: access.error,
      message: access.error,
      code: access.code,
    },
    { status: 403 }
  );
}

export function isOrganizationLockedPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return HOSTED_ORG_LOCKED_PATHS.some(
    (suffix) => normalized === suffix || normalized.endsWith(suffix)
  );
}

/**
 * HTTP gate for Better Auth org mutations (invite into that org, etc.).
 * Self-host and non-mutation paths pass through. Sign-in / set-active /
 * accept-invitation stay open.
 */
export async function hostedOrgSoftLockHttpResponse(
  request: { method: string; url: string },
  opts: {
    isHosted: boolean;
    loadActiveOrgMetadata: () => Promise<unknown>;
    now?: Date;
  }
): Promise<Response | null> {
  if (!opts.isHosted) return null;
  const method = request.method.toUpperCase();
  if (method !== "POST" && method !== "DELETE" && method !== "PATCH") {
    return null;
  }
  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return null;
  }
  if (!isOrganizationLockedPath(pathname)) return null;

  let metadata: unknown;
  try {
    metadata = await opts.loadActiveOrgMetadata();
  } catch {
    return null;
  }
  return hostedOrgSoftLockJson(
    hostedOrgAccess(metadata, opts.now ?? new Date(), { APP_MODE: "hosted" })
  );
}
