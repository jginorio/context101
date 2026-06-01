import {
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolveBrainFromRequest } from "@/lib/brains-server";
import { bucketForBrain, s3 } from "@/utils/s3";

/**
 * GET /api/wiki/runs[?brain=<id>]
 *
 * Returns the active brain's wiki-generation run history — one record per run
 * written by the generator under `wiki/_runs/<run_id>.json`. Each record is
 * self-contained (per-stage token + estimated-cost breakdown), so the Costs
 * tab can render the list and the drill-down without a second fetch.
 *
 * Scoped to the team wiki in v1; per-repo code-wiki runs live under their own
 * `wiki/code/<repo>/_runs/` and are not listed here yet.
 */
const RUNS_PREFIX = "wiki/_runs/";

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

async function listRunKeys(bucket: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: RUNS_PREFIX,
        ContinuationToken: token,
      })
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key && obj.Key.endsWith(".json")) keys.push(obj.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

export async function GET(request: NextRequest) {
  const r = await resolveBrainFromRequest(request);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const bucket = bucketForBrain(r.brain);

  try {
    const keys = await listRunKeys(bucket);
    const records = await Promise.all(
      keys.map((key) => readJson<Record<string, unknown>>(bucket, key))
    );
    const runs = records.filter(
      (rec): rec is Record<string, unknown> => rec !== null
    );
    // Newest first by generated_at (falls back to run_id, which is the
    // timestamp-derived id, so the ordering holds either way).
    runs.sort((a, b) => {
      const av = String(a.generated_at ?? a.run_id ?? "");
      const bv = String(b.generated_at ?? b.run_id ?? "");
      return bv.localeCompare(av);
    });

    return NextResponse.json({ runs });
  } catch (err) {
    console.error("wiki runs failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
