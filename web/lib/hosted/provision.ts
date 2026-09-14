import { createHash, randomBytes } from "node:crypto";

export type HostedProvisionBody = {
  email: string;
  organizationName?: string;
  name?: string;
  idempotencyKey?: string;
  creemCustomerId?: string;
  subscriptionId?: string;
};

export type HostedProvisionResult = {
  ok: true;
  organizationId: string;
  userId: string;
  createdUser: boolean;
  createdOrganization: boolean;
  loginUrl: string;
  nextStep: "password_reset" | "sign_in";
};

export type HostedUser = { id: string; email: string; name: string };
export type HostedOrganization = {
  id: string;
  name: string;
  slug: string;
  metadata: string | null;
};
export type HostedMembership = { id: string; role: string };

export type HostedProvisionStore = {
  findUserByEmail(email: string): Promise<HostedUser | null>;
  findOrganizationBySlug(slug: string): Promise<HostedOrganization | null>;
  findMembership(
    userId: string,
    organizationId: string
  ): Promise<HostedMembership | null>;
  setMemberRole(memberId: string, role: string): Promise<void>;
  signUpEmail(input: {
    name: string;
    email: string;
    password: string;
  }): Promise<{ id: string }>;
  createOrganization(input: {
    name: string;
    slug: string;
    userId: string;
    metadata: Record<string, string>;
  }): Promise<{ id: string; name: string; slug: string }>;
  addMember(input: {
    userId: string;
    organizationId: string;
    role: string;
  }): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PRIVILEGED_ROLES = new Set(["admin", "owner"]);

export function slugify(input: string) {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "team"
  );
}

export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "member";
  const cleaned = local.replace(/[._-]+/g, " ").trim();
  if (!cleaned) return "Member";
  return cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function randomPassword(): string {
  return randomBytes(32).toString("base64url");
}

export function hostedOrganizationSlug(input: {
  subscriptionId?: string;
  idempotencyKey?: string;
  creemCustomerId?: string;
}): string | null {
  const raw = input.subscriptionId
    ? `sub:${input.subscriptionId}`
    : input.idempotencyKey
      ? `idemp:${input.idempotencyKey}`
      : input.creemCustomerId
        ? `cust:${input.creemCustomerId}`
        : null;
  if (!raw) return null;
  return `hosted-${createHash("sha256").update(raw).digest("hex").slice(0, 20)}`;
}

export function parseHostedProvisionBody(
  raw: unknown
): { ok: true; value: HostedProvisionBody } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "email is required" };
  }
  const body = raw as Record<string, unknown>;
  if (typeof body.email !== "string" || !body.email.trim()) {
    return { ok: false, error: "email is required" };
  }
  const email = body.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "email is invalid" };
  }

  const optionalKeys = [
    "organizationName",
    "name",
    "idempotencyKey",
    "creemCustomerId",
    "subscriptionId",
  ] as const;
  const optional: Partial<HostedProvisionBody> = {};
  for (const key of optionalKeys) {
    const value = body[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string") {
      return { ok: false, error: `${key} must be a string` };
    }
    const trimmed = value.trim();
    if (trimmed) optional[key] = trimmed;
  }

  return { ok: true, value: { email, ...optional } };
}

function isAlreadyExistsError(err: unknown): boolean {
  const message = (
    err instanceof Error ? err.message : String(err)
  ).toLowerCase();
  return message.includes("already") || message.includes("exists");
}

function provisionMetadata(input: HostedProvisionBody): Record<string, string> {
  const metadata: Record<string, string> = { hostedProvision: "true" };
  if (input.subscriptionId) metadata.subscriptionId = input.subscriptionId;
  if (input.creemCustomerId) metadata.creemCustomerId = input.creemCustomerId;
  if (input.idempotencyKey) metadata.idempotencyKey = input.idempotencyKey;
  return metadata;
}

export async function provisionHostedOrganization(
  input: HostedProvisionBody,
  store: HostedProvisionStore,
  options: {
    appUrl: string;
    randomPassword?: () => string;
    randomSuffix?: () => string;
  }
): Promise<HostedProvisionResult> {
  const displayName = input.name?.trim() || nameFromEmail(input.email);
  const orgName =
    input.organizationName?.trim() || `${displayName}'s workspace`;
  const loginUrl = `${options.appUrl.replace(/\/$/, "")}/login`;

  let createdUser = false;
  let user = await store.findUserByEmail(input.email);
  if (!user) {
    try {
      const created = await store.signUpEmail({
        name: displayName,
        email: input.email,
        password: (options.randomPassword ?? randomPassword)(),
      });
      user = { id: created.id, email: input.email, name: displayName };
      createdUser = true;
    } catch (err) {
      const existing = await store.findUserByEmail(input.email);
      if (!existing || !isAlreadyExistsError(err)) throw err;
      user = existing;
    }
  }

  const deterministicSlug = hostedOrganizationSlug(input);
  const slug =
    deterministicSlug ??
    `${slugify(orgName).slice(0, 70)}-${(options.randomSuffix ?? randomPassword)().slice(0, 6).toLowerCase()}`;

  let createdOrganization = false;
  let org = deterministicSlug
    ? await store.findOrganizationBySlug(deterministicSlug)
    : null;

  if (!org) {
    try {
      const created = await store.createOrganization({
        name: orgName,
        slug,
        userId: user.id,
        metadata: provisionMetadata(input),
      });
      org = {
        id: created.id,
        name: created.name,
        slug: created.slug,
        metadata: null,
      };
      createdOrganization = true;
    } catch (err) {
      const existing = await store.findOrganizationBySlug(slug);
      if (!existing || !isAlreadyExistsError(err)) throw err;
      org = existing;
    }
  }

  const membership = await store.findMembership(user.id, org.id);
  if (!membership) {
    await store.addMember({
      userId: user.id,
      organizationId: org.id,
      role: "admin",
    });
  } else if (!PRIVILEGED_ROLES.has(membership.role)) {
    await store.setMemberRole(membership.id, "admin");
  }

  if (createdUser) {
    await store.requestPasswordReset(input.email);
  }

  return {
    ok: true,
    organizationId: org.id,
    userId: user.id,
    createdUser,
    createdOrganization,
    loginUrl,
    nextStep: createdUser ? "password_reset" : "sign_in",
  };
}
