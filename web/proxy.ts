import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { fetchAuthSession } from "aws-amplify/auth/server";

import { runWithAmplifyServerContext } from "@/utils/amplify-server-utils";

/**
 * Auth gate. Redirects any unauthenticated request to /login.
 *
 * Note: this is the new Next.js `proxy.ts` file convention
 * (renamed from `middleware.ts`).
 */
export async function proxy(request: NextRequest) {
  const response = NextResponse.next();

  const isAuthed = await runWithAmplifyServerContext({
    nextServerContext: { request, response },
    operation: async (ctx) => {
      try {
        const session = await fetchAuthSession(ctx);
        return !!session.tokens?.idToken;
      } catch {
        return false;
      }
    },
  });

  if (!isAuthed) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Match everything except:
  //  - /login (the page itself)
  //  - /_next (Next.js internals)
  //  - /api/public/* (if we ever add public endpoints)
  //  - static files (svg/png/etc.)
  matcher: [
    "/((?!login|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
