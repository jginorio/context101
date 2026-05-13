import {
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolveBrainFromRequest } from "@/lib/brains-server";
import { bucketForBrain, s3 } from "@/utils/s3";

/**
 * GET /api/wiki/index[?brain=<id>]
 *
 * Returns the active brain's team wiki nav (`wiki/_index.json`) plus
 * metadata (`wiki/_meta.json`) — and a list of per-repo code wikis under
 * `wiki/code/<repo-slug>/`, each with its own _index + _meta.
 *
 * 404-ish empty payload if nothing has been generated yet for this brain.
 */
async function readJson<T>(bucket: string, key: string): Promise<T | null> {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    const body = await res.Body?.transformToString();
    return body ? (JSON.parse(body) as T) : null;
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw err;
  }
}

async function listCodeWikiRepoSlugs(bucket: string): Promise<string[]> {
  const slugs: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
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

export async function GET(request: NextRequest) {
  const r = await resolveBrainFromRequest(request);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const bucket = bucketForBrain(r.brain);

  try {
    const [index, meta, codeRepoSlugs] = await Promise.all([
      readJson<unknown>(bucket, "wiki/_index.json"),
      readJson<unknown>(bucket, "wiki/_meta.json"),
      listCodeWikiRepoSlugs(bucket),
    ]);

    const codeWikis = await Promise.all(
      codeRepoSlugs.map(async (slug) => {
        const [cIndex, cMeta] = await Promise.all([
          readJson<unknown>(bucket, `wiki/code/${slug}/_index.json`),
          readJson<unknown>(bucket, `wiki/code/${slug}/_meta.json`),
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
