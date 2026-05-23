"use client";

import { Authenticator, useAuthenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import "@/utils/amplify-client-config";

function Redirector() {
  const { authStatus } = useAuthenticator((ctx) => [ctx.authStatus]);
  const router = useRouter();
  const search = useSearchParams();
  // Default to /knowledge, the authenticated admin home. The app root is
  // only a redirect now; the public marketing site lives in ../site.
  const next = search.get("next") || "/knowledge";

  React.useEffect(() => {
    if (authStatus === "authenticated") {
      router.replace(next);
    }
  }, [authStatus, router, next]);

  return null;
}

function LoginContent() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 sm:p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Context101</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to manage the team knowledge base
          </p>
        </div>

        <Authenticator hideSignUp loginMechanisms={["email"]}>
          <Redirector />
        </Authenticator>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <React.Suspense fallback={null}>
      <LoginContent />
    </React.Suspense>
  );
}
