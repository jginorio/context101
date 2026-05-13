import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolveBrainFromRequest } from "@/lib/brains-server";
import { bucketForBrain, s3 } from "@/utils/s3";

/**
 * POST /api/files/move[?brain=<id>]
 * Body: { from: string, to: string }
 *
 * Rename/move within the active brain's docs bucket. S3 has no atomic
 * move — this is CopyObject + DeleteObject. If either `from` or `to` ends
 * with "/", it's treated as a folder and every child is copied/moved
 * recursively.
 */
export async function POST(request: NextRequest) {
  const r = await resolveBrainFromRequest(request);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const bucket = bucketForBrain(r.brain);

  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.from !== "string" ||
    typeof body.to !== "string" ||
    body.from.length === 0 ||
    body.to.length === 0
  ) {
    return NextResponse.json(
      { error: "from and to are required" },
      { status: 400 }
    );
  }
  if (
    body.from.includes("..") ||
    body.to.includes("..") ||
    body.from.startsWith("/") ||
    body.to.startsWith("/")
  ) {
    return NextResponse.json({ error: "invalid key" }, { status: 400 });
  }
  if (body.from === body.to) {
    return NextResponse.json({ ok: true, moved: 0 });
  }

  try {
    const isFolder = body.from.endsWith("/");
    if (isFolder) {
      // Recursive copy + delete. Paginate in case of many files.
      let token: string | undefined;
      let moved = 0;
      do {
        const list = await s3.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: body.from,
            ContinuationToken: token,
          })
        );
        const keys =
          list.Contents?.map((c) => c.Key).filter(Boolean) as string[] | [];
        for (const k of keys) {
          const newKey = body.to + k.slice(body.from.length);
          await s3.send(
            new CopyObjectCommand({
              Bucket: bucket,
              CopySource: `${bucket}/${encodeURIComponent(k)}`,
              Key: newKey,
            })
          );
          moved++;
        }
        if (keys.length > 0) {
          await s3.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: {
                Objects: keys.map((k) => ({ Key: k })),
                Quiet: true,
              },
            })
          );
        }
        token = list.IsTruncated ? list.NextContinuationToken : undefined;
      } while (token);
      return NextResponse.json({ ok: true, moved });
    }

    // Single-file move
    await s3.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${encodeURIComponent(body.from)}`,
        Key: body.to,
      })
    );
    await s3.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: body.from })
    );
    return NextResponse.json({ ok: true, moved: 1 });
  } catch (err) {
    console.error("move failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
