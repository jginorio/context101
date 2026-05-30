"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { authClient } from "@/lib/auth/client";
import { deploymentConfig } from "@/lib/deployment/config";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";

export function LoginForm({ setupAvailable }: { setupAvailable: boolean }) {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/knowledge";
  const [mode, setMode] = React.useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const canSignUp = deploymentConfig.allowPublicSignup;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === "sign-up") {
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
      // Everyone lands on the org chooser after auth — pick (or create) the
      // workspace to open. It carries `next` through for deep links.
      router.replace(`/orgs?next=${encodeURIComponent(next)}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{mode === "sign-up" ? "Create account" : "Sign in"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={submit}>
          {mode === "sign-up" ? (
            <Input
              autoComplete="name"
              onChange={(event) => setName(event.target.value)}
              placeholder="Name"
              required
              value={name}
            />
          ) : null}
          <Input
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            required
            type="email"
            value={email}
          />
          <PasswordInput
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            minLength={8}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            required
            value={password}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button className="w-full" disabled={loading} type="submit">
            {loading ? "Working..." : mode === "sign-up" ? "Create account" : "Sign in"}
          </Button>
        </form>

        {canSignUp ? (
          <div className="mt-4 text-center text-sm text-muted-foreground">
            {mode === "sign-up" ? "Already have an account?" : "Need an account?"}{" "}
            <button
              className="text-foreground underline underline-offset-4"
              onClick={() => setMode(mode === "sign-up" ? "sign-in" : "sign-up")}
              type="button"
            >
              {mode === "sign-up" ? "Sign in" : "Sign up"}
            </button>
          </div>
        ) : null}

        {setupAvailable ? (
          <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            Fresh self-hosted deployment?{" "}
            <a className="text-foreground underline underline-offset-4" href="/setup">
              Create the first admin
            </a>
            .
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
