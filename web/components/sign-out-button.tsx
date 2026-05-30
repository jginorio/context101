"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";

/**
 * Signs the user out of Better Auth (clears the session cookie via
 * /api/auth/sign-out) and redirects to the login page.
 *
 * Note: this replaces the old Amplify/Cognito `signOut()`, which no longer
 * does anything now that auth is Better Auth — calling it left the Better
 * Auth session cookie in place, so the user appeared to stay signed in.
 */
export function SignOutButton({
  next = "/knowledge",
  className,
}: {
  next?: string;
  className?: string;
}) {
  const [pending, setPending] = React.useState(false);

  async function handleSignOut() {
    setPending(true);
    try {
      await authClient.signOut();
    } catch {
      // Even if the network call fails, fall through to the login page —
      // the middleware will re-gate the session on the next request.
    }
    window.location.href = `/login?next=${encodeURIComponent(next)}`;
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleSignOut}
      disabled={pending}
      className={className}
    >
      {pending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
      Sign out
    </Button>
  );
}
