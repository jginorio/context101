import { getSessionCookie } from "better-auth/cookies";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Auth gate. Redirects any unauthenticated request to /login.
 *
 * Note: this is the new Next.js `proxy.ts` file convention
 * (renamed from `middleware.ts`).
 */
export async function proxy(request: NextRequest) {
  const isAuthed = !!getSessionCookie(request);

  if (!isAuthed) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Match everything except:
  //  - / (a tiny server redirect into the authenticated app)
  //  - /login and /setup
  //  - /api/auth and /api/setup
  //  - /_next (Next.js internals)
  //  - static files (svg/png/etc.)
  // Using `.+` instead of `.*` so the empty path (i.e. `/`) doesn't match
  // and is served as the public landing without an auth round-trip.
  matcher: [
    "/((?!login|setup|api/auth|api/setup|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).+)",
  ],
};
