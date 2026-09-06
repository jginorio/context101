import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { readAuthContext } from "@/lib/brains-server";
import {
  getGithubAppConfig,
  getGithubAppProfile,
} from "@/utils/github-app";
import { listGithubInstallations } from "@/utils/github-installations";

/**
 * GET /api/connectors/github-app — status for the add-source dialog.
 * { configured: boolean, slug?: string, installed?: boolean, installations?: [] }
 */
export async function GET(request: NextRequest) {
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  try {
    const cfg = await getGithubAppConfig();
    if (!cfg) return NextResponse.json({ configured: false });
    const [installations, profile] = await Promise.all([
      listGithubInstallations(auth.orgId),
      getGithubAppProfile(cfg),
    ]);
    return NextResponse.json({
      configured: true,
      slug: profile.slug,
      installed: installations.length > 0,
      installations: installations.map((installation) => ({
        installationId: installation.installationId,
        accountLogin: installation.accountLogin,
        accountType: installation.accountType,
        repositorySelection: installation.repositorySelection,
        settingsUrl: installation.settingsUrl,
      })),
    });
  } catch (err) {
    console.error("github app status failed:", err);
    return NextResponse.json(
      { error: "GitHub connection status could not be loaded" },
      { status: 500 }
    );
  }
}
