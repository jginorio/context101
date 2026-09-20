/**
 * Hosted org policy: gate `organization.create` only when
 * `APP_MODE=hosted` (the one AWS space we operate). Self-host
 * (`APP_MODE=self_hosted` or unset — the default) keeps full org create.
 *
 * Billing / public-signup flags and APP_URL do not flip this gate.
 *
 * Better Auth's `allowUserToCreateOrganization: false` still lets
 * privileged server calls (`auth.api.createOrganization` with no
 * session + explicit `userId`) through, so hosted provision can keep
 * using that path. Session / HTTP `organization/create` is rejected
 * on Hosted only.
 */

import { isHostedDeployment } from "@/lib/deployment/config";

export const HOSTED_ORG_CREATE_ERROR =
  "Hosted organizations are created at checkout";

export const HOSTED_ORG_CREATE_CODE = "HOSTED_ORG_CREATE_DISABLED";

/** User-facing Better Auth organization plugin actions. */
export type OrgUserAction =
  | "create"
  | "inviteMember"
  | "acceptInvitation"
  | "rejectInvitation"
  | "cancelInvitation"
  | "setActive"
  | "listMembers"
  | "listInvitations"
  | "updateMemberRole"
  | "removeMember"
  | "updateOrganization"
  | "getFullOrganization";

export function allowUserToCreateOrganization(isHosted: boolean): boolean {
  return !isHosted;
}

/** Resolve the create-org gate from env. Hosted only — self-host stays open. */
export function organizationCreatePolicy(env: NodeJS.Dict<string> = process.env): {
  isHosted: boolean;
  allowUserToCreateOrganization: boolean;
} {
  const isHosted = isHostedDeployment(env);
  return {
    isHosted,
    allowUserToCreateOrganization: allowUserToCreateOrganization(isHosted),
  };
}

export function isHostedOrgActionAllowed(
  action: OrgUserAction,
  isHosted: boolean
): boolean {
  if (action === "create") return !isHosted;
  return true;
}

/**
 * Match Better Auth's POST `/organization/create` only — not
 * `/organization/create-team` or `/organization/create-role`.
 */
export function isOrganizationCreatePath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return (
    normalized === "/organization/create" ||
    normalized.endsWith("/organization/create")
  );
}

export function hostedOrgCreateHttpResponse(
  request: { method: string; url: string },
  isHosted: boolean
): Response | null {
  if (!isHosted) return null;
  if (request.method.toUpperCase() !== "POST") return null;
  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return null;
  }
  if (!isOrganizationCreatePath(pathname)) return null;
  return Response.json(
    {
      message: HOSTED_ORG_CREATE_ERROR,
      code: HOSTED_ORG_CREATE_CODE,
    },
    { status: 403 }
  );
}

export function orgsChooserCopy({
  isHosted,
  orgCount,
}: {
  isHosted: boolean;
  orgCount: number;
}): { heading: string; description: string; allowCreate: boolean } {
  const allowCreate = allowUserToCreateOrganization(isHosted);
  return {
    heading: "Choose an organization",
    allowCreate,
    description:
      orgCount === 0
        ? allowCreate
          ? "Create your first organization to get started."
          : "You haven't been invited to an organization yet. Ask an admin to send you an invite."
        : "Pick the workspace you want to open.",
  };
}
