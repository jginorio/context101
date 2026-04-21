import {
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

import { DOCS_BUCKET, s3 } from "@/utils/s3";
import { auditBrainStream } from "@/utils/bedrock";

export const maxDuration = 300;

/**
 * POST /api/brain/audit
 *
 * Streams Claude Opus's tokens straight to the client so the connection
 * stays alive past Amplify Hosting's edge timeout (~30s). The client
 * accumulates the full text and JSON-parses at the end. We also prepend
 * a fileCount header line ("__meta__:{"fileCount":N}\n") so the UI can
 * report coverage without a separate request.
 */
export async function POST() {
  if (!DOCS_BUCKET) {
    return new Response(
      JSON.stringify({ error: "DOCS_BUCKET env var is not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    // List all .md files (paginated)
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const list = await s3.send(
        new ListObjectsV2Command({
          Bucket: DOCS_BUCKET,
          ContinuationToken: token,
        })
      );
      for (const obj of list.Contents ?? []) {
        const k = obj.Key;
        if (!k) continue;
        if (k.endsWith("/")) continue;
        if (k.endsWith("/.keep") || k === ".keep") continue;
        if (k.endsWith(".metadata.json")) continue;
        if (!k.toLowerCase().endsWith(".md")) continue;
        keys.push(k);
      }
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);

    if (keys.length === 0) {
      return Response.json({ findings: [], fileCount: 0 });
    }

    const files = await Promise.all(
      keys.map(async (k) => {
        const obj = await s3.send(
          new GetObjectCommand({ Bucket: DOCS_BUCKET, Key: k })
        );
        const content = (await obj.Body?.transformToString("utf-8")) ?? "";
        return { path: k, content };
      })
    );

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // Small meta header so the client knows how many files got audited.
        controller.enqueue(
          encoder.encode(`__meta__:${JSON.stringify({ fileCount: files.length })}\n`)
        );
        try {
          for await (const chunk of auditBrainStream(files)) {
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
    console.error("audit failed:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
