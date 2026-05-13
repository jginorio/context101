import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolveBrainFromRequest } from "@/lib/brains-server";
import { bucketForBrain, s3 } from "@/utils/s3";

/**
 * GET /api/files/list?prefix=some/prefix/[&brain=<id>]
 *
 * Returns the direct children of `prefix` in the active brain's docs bucket:
 *   - folders: common prefixes (one "level" down)
 *   - files:   keys directly under the prefix
 *
 * The auth gate in proxy.ts has already verified the user is signed in.
 * The brain is resolved via `?brain=` query → `x-brain-id` header →
 * `ctx_brain` cookie → "default".
 */
export async function GET(request: NextRequest) {
  const r = await resolveBrainFromRequest(request);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const bucket = bucketForBrain(r.brain);

  const prefix = request.nextUrl.searchParams.get("prefix") ?? "";

  try {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        Delimiter: "/",
      })
    );

    const folders =
      res.CommonPrefixes?.map((p) => ({
        type: "folder" as const,
        key: p.Prefix ?? "",
        name: (p.Prefix ?? "")
          .slice(prefix.length)
          .replace(/\/$/, ""),
      })).filter((f) => f.name.length > 0) ?? [];

    const files =
      res.Contents?.filter((c) => {
        const key = c.Key ?? "";
        // Skip placeholder .keep objects and any metadata sidecars
        if (key.endsWith("/")) return false;
        if (key.endsWith("/.keep") || key === ".keep") return false;
        if (key.endsWith(".metadata.json")) return false;
        return true;
      }).map((c) => ({
        type: "file" as const,
        key: c.Key ?? "",
        name: (c.Key ?? "").slice(prefix.length),
        size: c.Size ?? 0,
        modified: c.LastModified?.toISOString() ?? null,
      })) ?? [];

    return NextResponse.json({ prefix, folders, files });
  } catch (err) {
    console.error("list failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
