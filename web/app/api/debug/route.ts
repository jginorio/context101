import { NextResponse } from "next/server";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { DOCS_BUCKET, s3 } from "@/utils/s3";

/**
 * GET /api/debug
 *
 * Diagnostic endpoint — reports env var presence (not values), region,
 * and tries a single S3 list. Behind the auth proxy. Will remove once
 * things are working.
 */
export async function GET() {
  const envState = {
    DOCS_BUCKET: !!process.env.DOCS_BUCKET ? process.env.DOCS_BUCKET : null,
    AWS_REGION: process.env.AWS_REGION ?? null,
    AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION ?? null,
    CONTEXT101_AWS_ACCESS_KEY_ID_SET:
      !!process.env.CONTEXT101_AWS_ACCESS_KEY_ID,
    CONTEXT101_AWS_ACCESS_KEY_ID_PREFIX: process.env.CONTEXT101_AWS_ACCESS_KEY_ID
      ? process.env.CONTEXT101_AWS_ACCESS_KEY_ID.slice(0, 5) + "…"
      : null,
    CONTEXT101_AWS_SECRET_ACCESS_KEY_SET:
      !!process.env.CONTEXT101_AWS_SECRET_ACCESS_KEY,
    // Amplify auto-injects these when Lambda role is present; useful to see
    AWS_ACCESS_KEY_ID_SET: !!process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY_SET: !!process.env.AWS_SECRET_ACCESS_KEY,
    AWS_SESSION_TOKEN_SET: !!process.env.AWS_SESSION_TOKEN,
  };

  let s3Result: unknown = null;
  try {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: DOCS_BUCKET,
        Prefix: "",
        Delimiter: "/",
        MaxKeys: 5,
      })
    );
    s3Result = {
      ok: true,
      commonPrefixCount: res.CommonPrefixes?.length ?? 0,
      contentsCount: res.Contents?.length ?? 0,
    };
  } catch (err) {
    s3Result = {
      ok: false,
      name: err instanceof Error ? err.name : "unknown",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  return NextResponse.json({ envState, s3Result });
}
