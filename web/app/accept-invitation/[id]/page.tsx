"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";

type InviteInfo = {
  email: string;
  role: string | null;
  orgName: string;
  status: string;
  expired: boolean;
  hasAccount: boolean;
};

type Phase =
  | { kind: "loading" }
  | { kind: "invalid"; message: string }
  | { kind: "wrong-account"; signedInAs: string; inviteFor: string }
  | { kind: "sign-in"; info: InviteInfo }
  | { kind: "sign-up"; info: InviteInfo }
  | { kind: "accepting" }
  | { kind: "done"; orgName?: string }
  | { kind: "error"; message: string };

export default function AcceptInvitationPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const invitationId = params?.id;
  const { data: session, isPending: sessionPending } = authClient.useSession();

  const [info, setInfo] = React.useState<InviteInfo | null>(null);
  const [infoError, setInfoError] = React.useState<string | null>(null);
  const [phase, setPhase] = React.useState<Phase>({ kind: "loading" });
  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const acceptedRef = React.useRef(false);

  // 1. Load invitation details.
  React.useEffect(() => {
    if (!invitationId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/invitation/${invitationId}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setInfoError(data?.error ?? "This invitation could not be found.");
          return;
        }
        setInfo(data as InviteInfo);
      } catch {
        if (!cancelled) setInfoError("Could not load this invitation.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invitationId]);

  const accept = React.useCallback(async () => {
    if (!invitationId || acceptedRef.current) return;
    acceptedRef.current = true;
    setPhase({ kind: "accepting" });
    const { data, error } = await authClient.organization.acceptInvitation({
      invitationId,
    });
    if (error) {
      acceptedRef.current = false;
      setPhase({
        kind: "error",
        message: error.message ?? "This invitation could not be accepted.",
      });
      return;
    }
    const orgId =
      (data as { member?: { organizationId?: string } } | null)?.member
        ?.organizationId ??
      (data as { invitation?: { organizationId?: string } } | null)?.invitation
        ?.organizationId;
    if (orgId) {
      await authClient.organization
        .setActive({ organizationId: orgId })
        .catch(() => {});
    }
    setPhase({ kind: "done", orgName: info?.orgName });
    setTimeout(() => router.push("/knowledge"), 1200);
  }, [invitationId, info?.orgName, router]);

  // 2. Resolve the right phase once we know the invitation + session state.
  React.useEffect(() => {
    if (acceptedRef.current) return;
    if (infoError) {
      setPhase({ kind: "invalid", message: infoError });
      return;
    }
    if (!info) {
      setPhase({ kind: "loading" });
      return;
    }
    if (info.status !== "pending") {
      setPhase({
        kind: "invalid",
        message:
          info.status === "accepted"
            ? "This invitation has already been accepted."
            : "This invitation is no longer active.",
      });
      return;
    }
    if (info.expired) {
      setPhase({
        kind: "invalid",
        message: "This invitation has expired. Ask an admin to re-invite you.",
      });
      return;
    }
    if (sessionPending) {
      setPhase({ kind: "loading" });
      return;
    }
    const signedInEmail = session?.user?.email ?? null;
    if (signedInEmail) {
      if (signedInEmail.toLowerCase() === info.email.toLowerCase()) {
        void accept();
      } else {
        setPhase({
          kind: "wrong-account",
          signedInAs: signedInEmail,
          inviteFor: info.email,
        });
      }
      return;
    }
    setPhase(
      info.hasAccount
        ? { kind: "sign-in", info }
        : { kind: "sign-up", info }
    );
  }, [info, infoError, session, sessionPending, accept]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!info) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await authClient.signIn.email({
        email: info.email,
        password,
      });
      if (res.error) throw new Error(res.error.message);
      await accept();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (!info || !invitationId) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/invitation/${invitationId}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `Could not create account (${res.status})`);
      }
      await accept();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function signOutAndReload() {
    await authClient.signOut().catch(() => {});
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 p-6">
          {phase.kind === "loading" || phase.kind === "accepting" ? (
            <div className="space-y-3 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
              <h1 className="text-lg font-semibold">
                {phase.kind === "accepting"
                  ? "Joining the organization…"
                  : "Loading invitation…"}
              </h1>
            </div>
          ) : phase.kind === "done" ? (
            <div className="space-y-3 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
              <h1 className="text-lg font-semibold">You&apos;re in</h1>
              <p className="text-sm text-muted-foreground">
                {phase.orgName
                  ? `Joined ${phase.orgName}. Taking you to the knowledge base…`
                  : "Taking you to the knowledge base…"}
              </p>
              <Link href="/knowledge">
                <Button size="sm">Go now</Button>
              </Link>
            </div>
          ) : phase.kind === "invalid" || phase.kind === "error" ? (
            <div className="space-y-3 text-center">
              <XCircle className="mx-auto h-8 w-8 text-destructive" />
              <h1 className="text-lg font-semibold">Invitation not accepted</h1>
              <p className="text-sm text-muted-foreground">{phase.message}</p>
              <Link href="/login">
                <Button size="sm" variant="outline">
                  Go to sign in
                </Button>
              </Link>
            </div>
          ) : phase.kind === "wrong-account" ? (
            <div className="space-y-3 text-center">
              <XCircle className="mx-auto h-8 w-8 text-destructive" />
              <h1 className="text-lg font-semibold">Wrong account</h1>
              <p className="text-sm text-muted-foreground">
                You&apos;re signed in as{" "}
                <span className="font-medium text-foreground">
                  {phase.signedInAs}
                </span>
                , but this invitation is for{" "}
                <span className="font-medium text-foreground">
                  {phase.inviteFor}
                </span>
                .
              </p>
              <Button size="sm" variant="outline" onClick={signOutAndReload}>
                Sign out &amp; switch account
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1 text-center">
                <h1 className="text-lg font-semibold">
                  Join {phase.info.orgName}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {phase.kind === "sign-up"
                    ? "Create your account to accept the invitation."
                    : "Sign in to accept the invitation."}
                </p>
              </div>
              <form
                className="space-y-3"
                onSubmit={phase.kind === "sign-up" ? handleSignUp : handleSignIn}
              >
                <Input value={phase.info.email} disabled readOnly />
                {phase.kind === "sign-up" ? (
                  <Input
                    autoComplete="name"
                    placeholder="Your name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                ) : null}
                <PasswordInput
                  autoComplete={
                    phase.kind === "sign-up" ? "new-password" : "current-password"
                  }
                  minLength={8}
                  placeholder="Password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {formError ? (
                  <p className="text-sm text-destructive">{formError}</p>
                ) : null}
                <Button className="w-full" disabled={submitting} type="submit">
                  {submitting ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : null}
                  {phase.kind === "sign-up"
                    ? "Create account & join"
                    : "Sign in & join"}
                </Button>
              </form>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
