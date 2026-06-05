"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import SpotlightCard from "@/components/SpotlightCard";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { authClient } from "@/lib/auth/client";

export function ResetPasswordForm() {
  const search = useSearchParams();
  const token = search.get("token");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!token) {
      setError("This reset link is missing a token.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const result = await authClient.resetPassword({
        newPassword: password,
        token,
      });
      if (result.error) throw new Error(result.error.message);
      setSuccess(true);
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SpotlightCard className="overflow-visible">
      <div className="p-6 sm:p-7">
        <h2 className="mb-2 text-center text-lg font-semibold tracking-tight">
          Choose a new password
        </h2>
        <p className="mb-5 text-center text-sm text-muted-foreground">
          Enter a new password for your Context101 account.
        </p>

        {success ? (
          <div className="space-y-4">
            <p className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-foreground">
              Your password was reset. You can sign in with the new password.
            </p>
            <Button className="w-full" render={<Link href="/login" />} size="lg">
              Back to sign in
            </Button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-1.5">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor="password"
              >
                New password
              </label>
              <PasswordInput
                id="password"
                autoComplete="new-password"
                disabled={loading || !token}
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
                required
                value={password}
              />
            </div>
            <div className="space-y-1.5">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor="confirm-password"
              >
                Confirm password
              </label>
              <PasswordInput
                id="confirm-password"
                autoComplete="new-password"
                disabled={loading || !token}
                minLength={8}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Repeat your new password"
                required
                value={confirmPassword}
              />
            </div>

            {error ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            {!token ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                This reset link is missing a token. Request a new reset email.
              </p>
            ) : null}

            <Button
              className="w-full"
              disabled={loading || !token}
              size="lg"
              type="submit"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Resetting…
                </>
              ) : (
                "Reset password"
              )}
            </Button>
          </form>
        )}
      </div>
    </SpotlightCard>
  );
}
