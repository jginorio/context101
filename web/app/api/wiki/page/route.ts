import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolveBrainFromRequest } from "@/lib/brains-server";
import { bucketForBrain, s3 } from "@/utils/s3";

/**
 * GET /api/wiki/page?slug=<slug>[&repo=<repo-slug>][&brain=<id>]
 *
 * Without `repo`: returns `wiki/<slug>.md` (the team wiki).
 * With `repo`:    returns `wiki/code/<repo>/<slug>.md` (per-repo code wiki).
 *
 * Scoped to the active brain's docs bucket.
 */
export async function GET(request: NextRequest) {
  const r = await resolveBrainFromRequest(request);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const bucket = bucketForBrain(r.brain);

  const slug = request.nextUrl.searchParams.get("slug");
  const repo = request.nextUrl.searchParams.get("repo");

  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) {
    return NextResponse.json(
      { error: "slug must be alphanumeric with dashes" },
      { status: 400 }
    );
  }
  if (repo !== null && !/^[a-z0-9-]+$/i.test(repo)) {
    return NextResponse.json(
      { error: "repo must be alphanumeric with dashes" },
      { status: 400 }
    );
  }

  const key = repo ? `wiki/code/${repo}/${slug}.md` : `wiki/${slug}.md`;

  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const content = (await res.Body?.transformToString()) ?? "";
    return NextResponse.json({ slug, repo, content });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "NoSuchKey" || name === "NotFound") {
      return NextResponse.json(
        { error: `wiki page not found: ${key}` },
        { status: 404 }
      );
    }
    console.error("wiki page failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
