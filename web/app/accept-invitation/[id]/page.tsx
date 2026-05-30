"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type State =
  | { status: "accepting" }
  | { status: "done"; orgName?: string }
  | { status: "error"; message: string };

export default function AcceptInvitationPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const invitationId = params?.id;
  const [state, setState] = React.useState<State>({ status: "accepting" });

  React.useEffect(() => {
    let cancelled = false;
    if (!invitationId) return;

    (async () => {
      const { data, error } = await authClient.organization.acceptInvitation({
        invitationId,
      });
      if (cancelled) return;

      if (error) {
        setState({
          status: "error",
          message: error.message ?? "This invitation could not be accepted.",
        });
        return;
      }

      // Make the joined org the active one so the app resolves brains for it
      // immediately (the session was created before this membership existed).
      const orgId =
        (data as { member?: { organizationId?: string } } | null)?.member
          ?.organizationId ??
        (data as { invitation?: { organizationId?: string } } | null)
          ?.invitation?.organizationId;
      if (orgId) {
        await authClient.organization
          .setActive({ organizationId: orgId })
          .catch(() => {});
      }

      setState({ status: "done" });
      setTimeout(() => router.push("/knowledge"), 1200);
    })();

    return () => {
      cancelled = true;
    };
  }, [invitationId, router]);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 p-6 text-center">
          {state.status === "accepting" ? (
            <>
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
              <h1 className="text-lg font-semibold">Accepting invitation…</h1>
              <p className="text-sm text-muted-foreground">
                Joining the organization.
              </p>
            </>
          ) : state.status === "done" ? (
            <>
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
              <h1 className="text-lg font-semibold">You&apos;re in</h1>
              <p className="text-sm text-muted-foreground">
                Taking you to the knowledge base…
              </p>
              <Link href="/knowledge">
                <Button size="sm">Go now</Button>
              </Link>
            </>
          ) : (
            <>
              <XCircle className="mx-auto h-8 w-8 text-destructive" />
              <h1 className="text-lg font-semibold">Invitation not accepted</h1>
              <p className="text-sm text-muted-foreground">{state.message}</p>
              <p className="text-xs text-muted-foreground">
                Invitations are tied to the email they were sent to — make sure
                you&apos;re signed in with that account.
              </p>
              <Link href="/knowledge">
                <Button size="sm" variant="outline">
                  Back to app
                </Button>
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
