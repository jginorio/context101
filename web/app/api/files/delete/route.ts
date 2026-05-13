import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolveBrainFromRequest } from "@/lib/brains-server";
import { bucketForBrain, s3 } from "@/utils/s3";

/**
 * POST /api/files/delete[?brain=<id>]
 * Body: { key: string, recursive?: boolean }
 *
 * - File: { key: "some/file.md" } → single DeleteObject
 * - Folder: { key: "some/folder/", recursive: true } → list + batch delete
 *   (S3 folders are just prefixes; deleting means deleting every object
 *   under the prefix).
 *
 * Scoped to the active brain's docs bucket.
 */
export async function POST(request: NextRequest) {
  const r = await resolveBrainFromRequest(request);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const bucket = bucketForBrain(r.brain);

  const body = await request.json().catch(() => null);
  if (!body || typeof body.key !== "string" || body.key.length === 0) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }
  if (body.key.includes("..")) {
    return NextResponse.json({ error: "invalid key" }, { status: 400 });
  }

  try {
    if (body.recursive) {
      // Delete everything under the prefix. Paginate in case of >1000 keys.
      let token: string | undefined;
      let deleted = 0;
      do {
        const list = await s3.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: body.key,
            ContinuationToken: token,
          })
        );
        const objects =
          list.Contents?.map((c) => ({ Key: c.Key! })).filter((o) => o.Key) ??
          [];
        if (objects.length > 0) {
          await s3.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: objects, Quiet: true },
            })
          );
          deleted += objects.length;
        }
        token = list.IsTruncated ? list.NextContinuationToken : undefined;
      } while (token);
      return NextResponse.json({ ok: true, deleted });
    }

    // Single-file delete
    await s3.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: body.key })
    );
    return NextResponse.json({ ok: true, deleted: 1 });
  } catch (err) {
    console.error("delete failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
