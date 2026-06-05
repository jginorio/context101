import * as React from "react";

import { LoginShell } from "@/components/login-shell";
import { ResetPasswordForm } from "@/components/reset-password-form";

export default function ResetPasswordPage() {
  return (
    <React.Suspense fallback={null}>
      <LoginShell>
        <ResetPasswordForm />
      </LoginShell>
    </React.Suspense>
  );
}
