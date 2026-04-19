import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    node: process.version,
    envHas: {
      DOCS_BUCKET: !!process.env.DOCS_BUCKET,
      CONTEXT101_AWS_ACCESS_KEY_ID: !!process.env.CONTEXT101_AWS_ACCESS_KEY_ID,
      CONTEXT101_AWS_SECRET_ACCESS_KEY: !!process.env.CONTEXT101_AWS_SECRET_ACCESS_KEY,
    },
  });
}
