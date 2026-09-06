import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { readAuthContext } from "@/lib/brains-server";
import {
  getGithubAppConfig,
  listInstallationRepositories,
  mintInstallationToken,
} from "@/utils/github-app";
import { listGithubInstallations } from "@/utils/github-installations";

/** Lists repositories granted to this Context101 organization's installations. */
export async function GET(request: NextRequest) {
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  try {
    const cfg = await getGithubAppConfig();
    if (!cfg) {
      return NextResponse.json(
        { error: "The Context101 GitHub App is not configured" },
        { status: 409 }
      );
    }

    const installations = await listGithubInstallations(auth.orgId);
    if (!installations.length) {
      return NextResponse.json({ repositories: [] });
    }

    const results = await Promise.allSettled(
      installations.map(async (installation) => {
        const token = await mintInstallationToken(
          cfg,
          installation.installationId
        );
        return listInstallationRepositories(
          token,
          installation.installationId,
          installation.accountLogin
        );
      })
    );

    const repositories = results
      .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    const failedInstallations = results.filter(
      (result) => result.status === "rejected"
    ).length;

    if (!repositories.length && failedInstallations === installations.length) {
      return NextResponse.json(
        {
          error:
            "GitHub access has expired or was removed. Reconnect the GitHub App or use a personal access token.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ repositories, failedInstallations });
  } catch (err) {
    console.error("github repositories list failed:", err);
    return NextResponse.json(
      {
        error:
          "We couldn't load GitHub repositories. Check the app's repository permissions or use a personal access token.",
      },
      { status: 500 }
    );
  }
}
