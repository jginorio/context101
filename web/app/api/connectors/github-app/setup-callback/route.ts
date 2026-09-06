import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { readAuthContext } from "@/lib/brains-server";
import {
  createGithubOauthState,
  getGithubAppConfig,
  getInstallationDetails,
  githubOauthUrl,
  verifyGithubState,
} from "@/utils/github-app";
import {
  getGithubInstallationForOrg,
  saveGithubInstallation,
} from "@/utils/github-installations";
import { getPublicOrigin } from "@/utils/public-origin";

/**
 * GET /api/connectors/github-app/setup-callback
 *   ?installation_id=…&setup_action=install|update[&state=<signed-state>]
 *
 * GitHub's post-install redirect. New installations continue through GitHub
 * user authorization so we can prove the signed-in user can manage the
 * installation before binding it to their Context101 organization.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const installationIdRaw = params.get("installation_id");
  const state = params.get("state");
  const baseRedirect = new URL("/sources", request.url);

  if (!installationIdRaw || !/^\d+$/.test(installationIdRaw)) {
    baseRedirect.searchParams.set("githubapp", "error");
    return NextResponse.redirect(baseRedirect);
  }

  try {
    const auth = await readAuthContext(request);
    if (!auth) {
      baseRedirect.searchParams.set("githubapp", "not_authenticated");
      return NextResponse.redirect(baseRedirect);
    }

    const cfg = await getGithubAppConfig();
    if (!cfg) {
      baseRedirect.searchParams.set("githubapp", "not_configured");
      return NextResponse.redirect(baseRedirect);
    }

    if (state) {
      const installState = verifyGithubState(cfg, state, "install");
      if (
        !installState ||
        installState.orgId !== auth.orgId ||
        installState.userId !== auth.userId
      ) {
        baseRedirect.searchParams.set("githubapp", "invalid_state");
        return NextResponse.redirect(baseRedirect);
      }

      const oauthState = createGithubOauthState(cfg, auth, installationIdRaw);
      return NextResponse.redirect(
        githubOauthUrl(cfg, getPublicOrigin(request), oauthState)
      );
    }

    // GitHub may revisit the Setup URL after repository permissions change.
    // Only refresh an installation already bound to this organization;
    // never claim an installation from an unsigned callback.
    const existing = await getGithubInstallationForOrg(
      auth.orgId,
      installationIdRaw
    );
    if (!existing) {
      baseRedirect.searchParams.set("githubapp", "start_in_context101");
      return NextResponse.redirect(baseRedirect);
    }
    const details = await getInstallationDetails(cfg, installationIdRaw);
    await saveGithubInstallation(auth, details);
    baseRedirect.searchParams.set("githubapp", "installed");
    return NextResponse.redirect(baseRedirect);
  } catch (err) {
    console.error("github app setup callback failed:", err);
    baseRedirect.searchParams.set("githubapp", "error");
    return NextResponse.redirect(baseRedirect);
  }
}
