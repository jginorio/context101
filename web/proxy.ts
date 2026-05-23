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
  //  - / (a tiny server redirect into the authenticated app)
  //  - /login (the page itself)
  //  - /_next (Next.js internals)
  //  - static files (svg/png/etc.)
  // Using `.+` instead of `.*` so the empty path (i.e. `/`) doesn't match
  // and is served as the public landing without an auth round-trip.
  matcher: [
    "/((?!login|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).+)",
  ],
};
