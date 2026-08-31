import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { readAuthContext } from "@/lib/brains-server";
import { getGithubAppConfig } from "@/utils/github-app";

/**
 * GET /api/connectors/github-app — status for the add-source dialog.
 * { configured: boolean, slug?: string, installed?: boolean }
 */
export async function GET(request: NextRequest) {
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  try {
    const cfg = await getGithubAppConfig();
    if (!cfg) return NextResponse.json({ configured: false });
    return NextResponse.json({
      configured: true,
      slug: cfg.slug,
      installed: !!cfg.installation_id,
    });
  } catch (err) {
    console.error("github app status failed:", err);
    return NextResponse.json({ configured: false });
  }
}
