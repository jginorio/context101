import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth/server";

let handlers: ReturnType<typeof toNextJsHandler> | undefined;

function getHandlers() {
  handlers ??= toNextJsHandler(getAuth());
  return handlers;
}

export async function GET(request: Request) {
  return getHandlers().GET(request);
}

export async function POST(request: Request) {
  return getHandlers().POST(request);
}
