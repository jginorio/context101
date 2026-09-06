import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";

import { readAuthContext } from "@/lib/brains-server";
import { buildAppManifest, getGithubAppConfig } from "@/utils/github-app";
import { getPublicOrigin, getPublicUrl } from "@/utils/public-origin";

/**
 * GET /api/connectors/github-app/create
 *
 * Entry point of GitHub's app-manifest flow: responds with a tiny
 * auto-submitting form that POSTs the manifest to GitHub. The user lands on
 * a pre-filled "Create GitHub App" page, clicks Create, and GitHub redirects
 * to /api/connectors/github-app/manifest-callback with a one-time code —
 * no keys or IDs are ever copy-pasted.
 */
export async function GET(request: NextRequest) {
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  if (
    process.env.NODE_ENV === "production" &&
    process.env.GITHUB_APP_MANIFEST_SETUP_ENABLED !== "true"
  ) {
    return NextResponse.json(
      {
        error:
          "GitHub App setup is disabled on this hosted instance. Configure it as the deployment operator or use a personal access token.",
      },
      { status: 403 }
    );
  }
  if (await getGithubAppConfig()) {
    return NextResponse.redirect(
      getPublicUrl(request, "/sources?githubapp=already_configured")
    );
  }

  const origin = getPublicOrigin(request);
  const setupNonce = randomBytes(32).toString("base64url");
  const manifest = buildAppManifest(origin, setupNonce);

  // GitHub requires a browser form POST with a `manifest` field.
  const html = `<!doctype html>
<html>
  <body>
    <p style="font-family: system-ui; color: #555">Redirecting to GitHub…</p>
    <form id="f" action="https://github.com/settings/apps/new" method="post">
      <input type="hidden" name="manifest" id="manifest" />
    </form>
    <script>
      document.getElementById("manifest").value = ${JSON.stringify(
        JSON.stringify(manifest)
      )};
      document.getElementById("f").submit();
    </script>
  </body>
</html>`;

  const response = new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
  response.cookies.set("ctx_github_app_setup", setupNonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60,
    path: "/api/connectors/github-app/manifest-callback",
  });
  return response;
}
