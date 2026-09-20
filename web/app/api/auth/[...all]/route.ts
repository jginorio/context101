import { toNextJsHandler } from "better-auth/next-js";

import { hostedOrgSoftLockHttpResponse } from "@/lib/auth/hosted-org-entitlement";
import { hostedOrgCreateHttpResponse } from "@/lib/auth/hosted-org-policy";
import { getAuth } from "@/lib/auth/server";
import { loadOrganizationMetadata } from "@/lib/brains-server";
import { deploymentConfig } from "@/lib/deployment/config";

let handlers: ReturnType<typeof toNextJsHandler> | undefined;

function getHandlers() {
  handlers ??= toNextJsHandler(getAuth());
  return handlers;
}

export async function GET(request: Request) {
  return getHandlers().GET(request);
}

export async function POST(request: Request) {
  const blocked = hostedOrgCreateHttpResponse(
    request,
    deploymentConfig.isHosted
  );
  if (blocked) return blocked;

  const locked = await hostedOrgSoftLockHttpResponse(request, {
    isHosted: deploymentConfig.isHosted,
    loadActiveOrgMetadata: async () => {
      const session = (await getAuth()
        .api.getSession({ headers: request.headers })
        .catch(() => null)) as {
        session?: { activeOrganizationId?: string | null };
      } | null;
      const orgId = session?.session?.activeOrganizationId ?? null;
      if (!orgId) return null;
      return loadOrganizationMetadata(orgId);
    },
  });
  if (locked) return locked;

  return getHandlers().POST(request);
}
