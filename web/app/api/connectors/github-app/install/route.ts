import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { readAuthContext } from "@/lib/brains-server";
import {
  createGithubInstallState,
  getGithubAppConfig,
  getGithubAppProfile,
  installUrl,
} from "@/utils/github-app";
import { getPublicUrl } from "@/utils/public-origin";

/**
 * Starts an organization-scoped GitHub App installation. GitHub handles
 * account and repository selection; the signed state binds the callback to
 * the active Context101 organization.
 */
export async function GET(request: NextRequest) {
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const cfg = await getGithubAppConfig();
  if (!cfg) {
    return NextResponse.redirect(
      getPublicUrl(request, "/sources?githubapp=not_configured")
    );
  }

  const state = createGithubInstallState(cfg, auth);
  const profile = await getGithubAppProfile(cfg);
  return NextResponse.redirect(installUrl(profile.slug, state));
}
