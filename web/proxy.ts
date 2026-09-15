import { getSessionCookie } from "better-auth/cookies";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getPublicUrl } from "@/utils/public-origin";

/**
 * Auth gate. Redirects any unauthenticated request to /login.
 *
 * Note: this is the new Next.js `proxy.ts` file convention
 * (renamed from `middleware.ts`).
 */
export async function proxy(request: NextRequest) {
  const isAuthed = !!getSessionCookie(request);

  if (!isAuthed) {
    const loginUrl = getPublicUrl(request, "/login");
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Match everything except:
  //  - / (a tiny server redirect into the authenticated app)
  //  - /login and /setup
  //  - /accept-invitation (invited users may not have an account/session yet)
  //  - /reset-password (the emailed reset link is used while logged out)
  //  - /api/auth and /api/setup
  //  - /api/invitation (public invite lookup + invite-scoped signup)
  //  - /_next (Next.js internals)
  //  - static files (svg/png/etc.)
  // Using `.+` instead of `.*` so the empty path (i.e. `/`) doesn't match
  // and is served as the public landing without an auth round-trip.
  matcher: [
    "/((?!login|setup|accept-invitation|reset-password|api/auth|api/setup|api/invitation|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).+)",
  ],
};
