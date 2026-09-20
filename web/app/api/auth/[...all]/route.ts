import { toNextJsHandler } from "better-auth/next-js";

import { hostedOrgCreateHttpResponse } from "@/lib/auth/hosted-org-policy";
import { getAuth } from "@/lib/auth/server";
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
  return getHandlers().POST(request);
}
