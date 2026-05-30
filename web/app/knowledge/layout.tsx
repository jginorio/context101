import * as React from "react";

import { requireActiveOrg } from "@/lib/auth/require-org";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireActiveOrg();
  return <>{children}</>;
}
