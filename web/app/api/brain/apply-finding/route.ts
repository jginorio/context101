import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { NextRequest } from "next/server";

import { DOCS_BUCKET, s3 } from "@/utils/s3";
import { applyFindingStream, type Finding } from "@/utils/bedrock";

export const maxDuration = 300;

/**
 * POST /api/brain/apply-finding
 * Body: { finding: Finding }
 *
 * Same streaming pattern as /audit — Claude's tokens flow continuously
 * so the edge doesn't 504. The client accumulates, parses JSON at end.
 * We prepend an "__originals__" line so the client can render diffs
 * without a separate round-trip.
 */
export async function POST(request: NextRequest) {
  if (!DOCS_BUCKET) {
    return new Response(
      JSON.stringify({ error: "DOCS_BUCKET env var is not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.finding !== "object") {
    return new Response(JSON.stringify({ error: "finding is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const finding = body.finding as Finding;
  if (!Array.isArray(finding.file_paths) || finding.file_paths.length === 0) {
    return new Response(
      JSON.stringify({ error: "finding.file_paths must be a non-empty array" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  if (finding.file_paths.some((p) => typeof p !== "string" || p.includes(".."))) {
    return new Response(JSON.stringify({ error: "invalid path in finding" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const files = await Promise.all(
      finding.file_paths.map(async (p) => {
        const obj = await s3.send(
          new GetObjectCommand({ Bucket: DOCS_BUCKET, Key: p })
        );
        const content = (await obj.Body?.transformToString("utf-8")) ?? "";
        return { path: p, content };
      })
    );

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // Send the originals so the client can compute diffs without
        // re-fetching once the new_content arrives.
        controller.enqueue(
          encoder.encode(
            `__originals__:${JSON.stringify({
              originals: files.map((f) => ({
                path: f.path,
                content: f.content,
              })),
            })}\n`
          )
        );
        try {
          for await (const chunk of applyFindingStream(finding, files)) {
            controller.enqueue(encoder.encode(chunk));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          controller.enqueue(
            encoder.encode(`\n__error__:${JSON.stringify({ error: msg })}\n`)
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    console.error("apply-finding failed:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
