import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { DOCS_BUCKET, s3 } from "@/utils/s3";

/**
 * GET /api/wiki/page?slug=<slug>[&repo=<repo-slug>]
 *
 * Without `repo`: returns `wiki/<slug>.md` (the team wiki).
 * With `repo`:    returns `wiki/code/<repo>/<slug>.md` (per-repo code wiki).
 */
export async function GET(request: NextRequest) {
  if (!DOCS_BUCKET) {
    return NextResponse.json(
      { error: "DOCS_BUCKET env var is not set" },
      { status: 500 }
    );
  }

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
    const res = await s3.send(
      new GetObjectCommand({ Bucket: DOCS_BUCKET, Key: key })
    );
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
