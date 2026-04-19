import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { DOCS_BUCKET, s3 } from "@/utils/s3";

/**
 * GET /api/files/get?key=path/to/file.md
 *
 * Returns the raw text content of a single S3 object.
 */
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "key param is required" }, { status: 400 });
  }
  if (!DOCS_BUCKET) {
    return NextResponse.json(
      { error: "DOCS_BUCKET env var is not set" },
      { status: 500 }
    );
  }

  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: DOCS_BUCKET, Key: key })
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
