import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

import { DOCS_BUCKET, s3 } from "@/utils/s3";

/**
 * GET /api/wiki/index
 *
 * Returns the wiki nav (`wiki/_index.json`) plus metadata
 * (`wiki/_meta.json`) written by the Fargate generator.
 *
 * Returns 404-ish empty payload if the wiki hasn't been generated yet —
 * the UI handles the "not yet" state.
 */
export async function GET() {
  if (!DOCS_BUCKET) {
    return NextResponse.json(
      { error: "DOCS_BUCKET env var is not set" },
      { status: 500 }
    );
  }

  async function readJson(key: string) {
    try {
      const res = await s3.send(
        new GetObjectCommand({ Bucket: DOCS_BUCKET, Key: key })
      );
      const body = await res.Body?.transformToString();
      return body ? JSON.parse(body) : null;
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === "NoSuchKey" || name === "NotFound") return null;
      throw err;
    }
  }

  try {
    const [index, meta] = await Promise.all([
      readJson("wiki/_index.json"),
      readJson("wiki/_meta.json"),
    ]);
    return NextResponse.json({ index, meta });
  } catch (err) {
    console.error("wiki index failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
