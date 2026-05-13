import { PutObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolveBrainFromRequest } from "@/lib/brains-server";
import { bucketForBrain, s3 } from "@/utils/s3";

/**
 * POST /api/files/put[?brain=<id>]
 * Body: { key: string, content: string, contentType?: string }
 *
 * Creates or updates a file in the active brain's docs bucket. S3
 * PutObject is idempotent — same endpoint for create + update.
 *
 * For "create folder", pass { key: "folder/.keep", content: "" }.
 * S3 has no real folders; ".keep" is our placeholder convention so
 * the folder shows up in listings.
 */
export async function POST(request: NextRequest) {
  const r = await resolveBrainFromRequest(request);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const bucket = bucketForBrain(r.brain);

  const body = await request.json().catch(() => null);
  if (!body || typeof body.key !== "string") {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }
  const key: string = body.key;
  const content: string = typeof body.content === "string" ? body.content : "";
  const contentType: string = body.contentType ?? guessContentType(key);

  if (key.startsWith("/") || key.includes("..")) {
    return NextResponse.json({ error: "invalid key" }, { status: 400 });
  }

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: content,
        ContentType: contentType,
      })
    );
    return NextResponse.json({ ok: true, key });
  } catch (err) {
    console.error("put failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

function guessContentType(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}
