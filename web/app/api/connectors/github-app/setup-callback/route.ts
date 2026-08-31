import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { InvokeCommand } from "@aws-sdk/client-lambda";

import {
  lambdaClient,
  pgGetConnectorById,
  pgUpdateConnector,
  syncFnNameFor,
} from "@/utils/connectors";
import { getBrainById } from "@/lib/brains-server";
import { bucketForBrain } from "@/utils/s3";
import {
  getGithubAppConfig,
  saveGithubAppConfig,
} from "@/utils/github-app";

/**
 * GET /api/connectors/github-app/setup-callback
 *   ?installation_id=…&setup_action=install|update[&state=<brainId>:<connectorId>]
 *
 * GitHub's post-install redirect (the app's Setup URL). Records the
 * installation id in the app config secret; when `state` carries a pending
 * connector (the flow started from "Add GitHub source"), marks it
 * app-authenticated and fires its first sync.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const installationIdRaw = params.get("installation_id");
  const state = params.get("state");
  const baseRedirect = new URL("/sources", request.url);

  const installationId = installationIdRaw ? Number(installationIdRaw) : NaN;
  if (!Number.isFinite(installationId)) {
    baseRedirect.searchParams.set("githubapp", "error");
    return NextResponse.redirect(baseRedirect);
  }

  try {
    const cfg = await getGithubAppConfig();
    if (!cfg) {
      baseRedirect.searchParams.set("githubapp", "not_configured");
      return NextResponse.redirect(baseRedirect);
    }

    // Remember the installation app-wide (one installation per deployment)
    // so future connections skip GitHub entirely when the repo is covered.
    if (cfg.installation_id !== installationId) {
      const { secret_arn: _drop, ...persistable } = cfg;
      void _drop;
      await saveGithubAppConfig({
        ...persistable,
        installation_id: installationId,
      });
    }

    // Installed directly from GitHub (or a permissions update) — no pending
    // connector to resume.
    if (!state) {
      baseRedirect.searchParams.set("githubapp", "installed");
      return NextResponse.redirect(baseRedirect);
    }

    const firstColon = state.indexOf(":");
    const brainId = firstColon >= 0 ? state.slice(0, firstColon) : "default";
    const connectorId =
      firstColon >= 0 ? state.slice(firstColon + 1) : state;

    const brain = await getBrainById(brainId);
    const row = await pgGetConnectorById(connectorId);
    if (!brain || !row || row.type !== "github") {
      baseRedirect.searchParams.set("githubapp", "connector_not_found");
      return NextResponse.redirect(baseRedirect);
    }
    baseRedirect.searchParams.set("brain", brainId);

    const metadataPatch: Record<string, unknown> = {
      ...((row.metadata as Record<string, unknown>) ?? {}),
      auth: "github-app",
      github_installation_id: installationId,
      github_app_secret_arn: cfg.secret_arn,
    };
    await pgUpdateConnector(row.orgId, row.brainId, row.id, {
      status: "syncing",
      metadata: metadataPatch,
    });

    const syncFn = syncFnNameFor("github");
    if (syncFn) {
      await lambdaClient
        .send(
          new InvokeCommand({
            FunctionName: syncFn,
            InvocationType: "Event",
            Payload: new TextEncoder().encode(
              JSON.stringify({
                connectorId: row.id,
                docsBucket: bucketForBrain(brain),
                brainId,
              })
            ),
          })
        )
        .catch((e) => console.error("initial sync invoke failed:", e));
    }

    baseRedirect.searchParams.set("connected", row.id);
    return NextResponse.redirect(baseRedirect);
  } catch (err) {
    console.error("github app setup callback failed:", err);
    baseRedirect.searchParams.set("githubapp", "error");
    return NextResponse.redirect(baseRedirect);
  }
}
