"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, LogIn, UserPlus } from "lucide-react";

import { authClient } from "@/lib/auth/client";
import { deploymentConfig } from "@/lib/deployment/config";
import SpotlightCard from "@/components/SpotlightCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export function LoginForm({ setupAvailable }: { setupAvailable: boolean }) {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/knowledge";
  const [mode, setMode] = React.useState<"forgot" | "sign-in" | "sign-up">(
    "sign-in"
  );
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const canSignUp = deploymentConfig.allowPublicSignup;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);

    try {
      if (mode === "forgot") {
        const result = await authClient.requestPasswordReset({
          email,
          redirectTo: "/reset-password",
        });
        if (result.error) throw new Error(result.error.message);
        setNotice("If that account exists, we sent a password reset email.");
        return;
      } else if (mode === "sign-up") {
        const result = await authClient.signUp.email({
          name,
          email,
          password,
          callbackURL: next,
        });
        if (result.error) throw new Error(result.error.message);
      } else {
        const result = await authClient.signIn.email({
          email,
          password,
          callbackURL: next,
        });
        if (result.error) throw new Error(result.error.message);
      }
      router.replace(`/orgs?next=${encodeURIComponent(next)}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SpotlightCard className="overflow-visible">
      <div className="p-6 sm:p-7">
        {mode === "forgot" ? (
          <h2 className="mb-2 text-center text-lg font-semibold tracking-tight">
            Reset password
          </h2>
        ) : canSignUp ? (
          <div className="mb-5 flex rounded-xl border border-border/60 bg-muted/30 p-1">
            <button
              type="button"
              onClick={() => setMode("sign-in")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                mode === "sign-in"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <LogIn className="size-3.5" />
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setMode("sign-up")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                mode === "sign-up"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <UserPlus className="size-3.5" />
              Sign up
            </button>
          </div>
        ) : (
          <h2 className="mb-5 text-center text-lg font-semibold tracking-tight">
            Sign in
          </h2>
        )}
        {mode === "forgot" ? (
          <p className="mb-5 text-center text-sm text-muted-foreground">
            Enter your email and we&apos;ll send you a link to choose a new
            password.
          </p>
        ) : null}

        <form className="space-y-4" onSubmit={submit}>
          {mode === "sign-up" ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="name">
                Name
              </label>
              <Input
                id="name"
                autoComplete="name"
                onChange={(event) => setName(event.target.value)}
                placeholder="Ada Lovelace"
                required
                value={name}
              />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="email">
              Email
            </label>
            <Input
              id="email"
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              required
              type="email"
              value={email}
            />
          </div>
          {mode !== "forgot" ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="password">
                Password
              </label>
              <PasswordInput
                id="password"
                autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={mode === "sign-up" ? "At least 8 characters" : "Your password"}
                required
                value={password}
              />
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {notice ? (
            <p className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-foreground">
              {notice}
            </p>
          ) : null}

          <Button className="w-full" disabled={loading} size="lg" type="submit">
            {loading ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Working…
              </>
            ) : mode === "forgot" ? (
              "Send reset link"
            ) : mode === "sign-up" ? (
              "Create account"
            ) : (
              "Sign in"
            )}
          </Button>
        </form>

        <div className="mt-4 text-center text-sm">
          {mode === "forgot" ? (
            <button
              className="font-medium text-foreground underline underline-offset-4"
              onClick={() => setMode("sign-in")}
              type="button"
            >
              Back to sign in
            </button>
          ) : (
            <button
              className="font-medium text-foreground underline underline-offset-4"
              onClick={() => setMode("forgot")}
              type="button"
            >
              Forgot your password?
            </button>
          )}
        </div>

        {setupAvailable ? (
          <>
            <Separator className="my-5" />
            <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
              Fresh self-hosted deployment?{" "}
              <a
                className="font-medium text-foreground underline underline-offset-4"
                href="/setup"
              >
                Create the first admin
              </a>
              .
            </div>
          </>
        ) : null}
      </div>
    </SpotlightCard>
  );
}
