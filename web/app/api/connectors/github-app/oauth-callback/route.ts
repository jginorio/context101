import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { readAuthContext } from "@/lib/brains-server";
import {
  exchangeGithubOauthCode,
  getGithubAppConfig,
  getInstallationDetails,
  githubOauthRedirectUri,
  userCanAccessInstallation,
  verifyGithubState,
} from "@/utils/github-app";
import { saveGithubInstallation } from "@/utils/github-installations";
import { getPublicOrigin, getPublicUrl } from "@/utils/public-origin";

/**
 * Verifies that the current GitHub user can access the installation selected
 * in the preceding install flow, then binds it to the active organization.
 * The short-lived user token is used for verification only and is not stored.
 */
export async function GET(request: NextRequest) {
  const redirect = getPublicUrl(request, "/sources");
  const code = request.nextUrl.searchParams.get("code");
  const stateValue = request.nextUrl.searchParams.get("state");

  try {
    const auth = await readAuthContext(request);
    if (!auth) {
      redirect.searchParams.set("githubapp", "not_authenticated");
      return NextResponse.redirect(redirect);
    }

    const cfg = await getGithubAppConfig();
    if (!cfg) {
      redirect.searchParams.set("githubapp", "not_configured");
      return NextResponse.redirect(redirect);
    }

    const state = stateValue
      ? verifyGithubState(cfg, stateValue, "oauth")
      : null;
    if (
      !code ||
      !state?.installationId ||
      state.orgId !== auth.orgId ||
      state.userId !== auth.userId
    ) {
      redirect.searchParams.set("githubapp", "invalid_state");
      return NextResponse.redirect(redirect);
    }

    const userToken = await exchangeGithubOauthCode(
      cfg,
      code,
      githubOauthRedirectUri(getPublicOrigin(request))
    );
    if (!(await userCanAccessInstallation(userToken, state.installationId))) {
      redirect.searchParams.set("githubapp", "permission_denied");
      return NextResponse.redirect(redirect);
    }

    const details = await getInstallationDetails(cfg, state.installationId);
    await saveGithubInstallation(auth, details);
    redirect.searchParams.set("githubapp", "installed");
    return NextResponse.redirect(redirect);
  } catch (err) {
    console.error("github app oauth callback failed:", err);
    redirect.searchParams.set("githubapp", "error");
    return NextResponse.redirect(redirect);
  }
}
