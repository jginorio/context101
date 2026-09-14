import { timingSafeEqual } from "node:crypto";

export const HOSTED_PROVISION_SECRET_ENV = "HOSTED_PROVISION_SECRET";
export const HOSTED_PROVISION_HEADER = "x-hosted-provision-secret";

/**
 * Accept either `x-hosted-provision-secret` (same shape as the conflict
 * ingest header) or `Authorization: Bearer <secret>`.
 */
export function presentedHostedProvisionSecret(
  headers: Pick<Headers, "get">
): string | null {
  const dedicated = headers.get(HOSTED_PROVISION_HEADER)?.trim();
  if (dedicated) return dedicated;
  const authorization = headers.get("authorization") ?? "";
  if (authorization.length >= 7 && authorization.slice(0, 7).toLowerCase() === "bearer ") {
    const token = authorization.slice(7).trim();
    return token || null;
  }
  return null;
}

export function hostedProvisionSecretsEqual(
  presented: string,
  expected: string
): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function hostedProvisionGate(input: {
  isHosted: boolean;
  expectedSecret: string | undefined;
  presentedSecret: string | null;
  hasDatabase: boolean;
}): { ok: true } | { ok: false; status: number; error: string } {
  if (!input.isHosted) {
    return { ok: false, status: 403, error: "hosted provision is disabled" };
  }
  const expected = input.expectedSecret?.trim() ?? "";
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: "HOSTED_PROVISION_SECRET is not configured",
    };
  }
  if (
    !input.presentedSecret ||
    !hostedProvisionSecretsEqual(input.presentedSecret, expected)
  ) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  if (!input.hasDatabase) {
    return { ok: false, status: 503, error: "DATABASE_URL is not configured" };
  }
  return { ok: true };
}
