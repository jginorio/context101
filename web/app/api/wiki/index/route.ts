import {
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

import { DOCS_BUCKET, s3 } from "@/utils/s3";

/**
 * GET /api/wiki/index
 *
 * Returns the team wiki nav (`wiki/_index.json`) plus metadata
 * (`wiki/_meta.json`) — and a list of per-repo code wikis under
 * `wiki/code/<repo-slug>/`, each with its own _index + _meta. The UI
 * uses this to render a "Code wikis" group in the sidebar.
 *
 * 404-ish empty payload if nothing has been generated yet.
 */
async function readJson<T>(key: string): Promise<T | null> {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: DOCS_BUCKET, Key: key })
    );
    const body = await res.Body?.transformToString();
    return body ? (JSON.parse(body) as T) : null;
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw err;
  }
}

async function listCodeWikiRepoSlugs(): Promise<string[]> {
  // Use Delimiter so we get only the immediate subdirectories of
  // wiki/code/, not every individual page key. CommonPrefixes returns
  // each subdirectory as "wiki/code/<slug>/".
  const slugs: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: DOCS_BUCKET,
        Prefix: "wiki/code/",
        Delimiter: "/",
        ContinuationToken: token,
      })
    );
    for (const cp of res.CommonPrefixes ?? []) {
      const p = cp.Prefix;
      if (!p) continue;
      const m = p.match(/^wiki\/code\/([^/]+)\/$/);
      if (m) slugs.push(m[1]);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return slugs;
}

export async function GET() {
  if (!DOCS_BUCKET) {
    return NextResponse.json(
      { error: "DOCS_BUCKET env var is not set" },
      { status: 500 }
    );
  }

  try {
    const [index, meta, codeRepoSlugs] = await Promise.all([
      readJson<unknown>("wiki/_index.json"),
      readJson<unknown>("wiki/_meta.json"),
      listCodeWikiRepoSlugs(),
    ]);

    const codeWikis = await Promise.all(
      codeRepoSlugs.map(async (slug) => {
        const [cIndex, cMeta] = await Promise.all([
          readJson<unknown>(`wiki/code/${slug}/_index.json`),
          readJson<unknown>(`wiki/code/${slug}/_meta.json`),
        ]);
        return { repoSlug: slug, index: cIndex, meta: cMeta };
      })
    );

    // Drop entries where _index.json hasn't been written yet (Fargate
    // task is mid-run, leftover folder, etc) — they'd render as empty
    // groups in the sidebar.
    const codeWikisReady = codeWikis.filter((c) => c.index !== null);

    return NextResponse.json({
      index,
      meta,
      codeWikis: codeWikisReady,
    });
  } catch (err) {
    console.error("wiki index failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
