import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolveBrainFromRequest } from "@/lib/brains-server";
import { bucketForBrain, s3 } from "@/utils/s3";

/**
 * GET /api/files/get?key=path/to/file.md[&brain=<id>]
 *
 * Returns the raw text content of a single S3 object from the active
 * brain's docs bucket.
 */
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "key param is required" }, { status: 400 });
  }
  const r = await resolveBrainFromRequest(request);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const bucket = bucketForBrain(r.brain);

  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    const body = (await res.Body?.transformToString("utf-8")) ?? "";
    return NextResponse.json({
      key,
      content: body,
      contentType: res.ContentType ?? "text/markdown",
      lastModified: res.LastModified?.toISOString() ?? null,
      size: res.ContentLength ?? 0,
    });
  } catch (err) {
    console.error("get failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
