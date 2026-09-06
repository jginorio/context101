import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { readAuthContext } from "@/lib/brains-server";
import {
  convertManifestCode,
  getGithubAppConfig,
  saveGithubAppConfig,
} from "@/utils/github-app";

/**
 * GET /api/connectors/github-app/manifest-callback?code=…
 *
 * GitHub redirects here after the user clicks "Create GitHub App" on the
 * manifest page. The one-time code is exchanged for the app's credentials
 * (id, slug, client secret, private key), which land in the
 * `context101-connector-github-app` secret. From then on the GitHub
 * connector dialog offers the tokenless install flow.
 */
export async function GET(request: NextRequest) {
  const auth = await readAuthContext(request);
  if (!auth) {
    // The browser carrying GitHub's redirect has the session cookie; an
    // anonymous hit here is someone replaying a URL.
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const code = request.nextUrl.searchParams.get("code");
  const setupState = request.nextUrl.searchParams.get("setup_state");
  const setupCookie = request.cookies.get("ctx_github_app_setup")?.value;
  if (!code || !setupState || setupState !== setupCookie) {
    return NextResponse.json(
      { error: "GitHub App setup could not be verified. Start again." },
      { status: 400 }
    );
  }

  try {
    if (await getGithubAppConfig()) {
      return NextResponse.redirect(
        new URL("/sources?githubapp=already_configured", request.url)
      );
    }
    const app = await convertManifestCode(code);
    await saveGithubAppConfig({
      app_id: app.id,
      slug: app.slug,
      client_id: app.client_id,
      client_secret: app.client_secret,
      private_key: app.pem,
      html_url: app.html_url,
    });
    return NextResponse.redirect(
      new URL(`/sources?githubapp=created`, request.url)
    );
  } catch (err) {
    console.error("github app manifest conversion failed:", err);
    return NextResponse.redirect(
      new URL(`/sources?githubapp=error`, request.url)
    );
  }
}
