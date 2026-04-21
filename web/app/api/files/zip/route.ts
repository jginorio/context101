import {
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import JSZip from "jszip";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { DOCS_BUCKET, s3 } from "@/utils/s3";

export const maxDuration = 60;

/**
 * POST /api/files/zip
 * Body: { keys: string[] }
 *
 * `keys` can mix files (e.g. "general-knowledge.md") and folders
 * (keys ending with "/", e.g. "domain-knowledge/"). Folders get
 * expanded recursively on the server. Returns the archive as
 * Content-Type: application/zip.
 */
export async function POST(request: NextRequest) {
  if (!DOCS_BUCKET) {
    return NextResponse.json(
      { error: "DOCS_BUCKET env var is not set" },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => null);
  if (
    !body ||
    !Array.isArray(body.keys) ||
    body.keys.length === 0 ||
    body.keys.some((k: unknown) => typeof k !== "string")
  ) {
    return NextResponse.json(
      { error: "keys must be a non-empty array of strings" },
      { status: 400 }
    );
  }

  // Deduplicate + reject obviously bad keys
  const requested = Array.from(new Set(body.keys as string[])).filter(
    (k) => !k.includes("..") && !k.startsWith("/")
  );

  try {
    // Expand folder prefixes to a flat list of file keys
    const files: string[] = [];
    for (const key of requested) {
      if (key.endsWith("/")) {
        // Folder — list everything under it, paginating
        let token: string | undefined;
        do {
          const list = await s3.send(
            new ListObjectsV2Command({
              Bucket: DOCS_BUCKET,
              Prefix: key,
              ContinuationToken: token,
            })
          );
          for (const obj of list.Contents ?? []) {
            const k = obj.Key;
            if (!k) continue;
            if (k.endsWith("/")) continue; // skip folder markers
            if (k.endsWith("/.keep") || k === ".keep") continue;
            if (k.endsWith(".metadata.json")) continue;
            files.push(k);
          }
          token = list.IsTruncated ? list.NextContinuationToken : undefined;
        } while (token);
      } else {
        files.push(key);
      }
    }

    if (files.length === 0) {
      return NextResponse.json(
        { error: "selection expanded to zero files" },
        { status: 400 }
      );
    }

    // Fetch each object and add to the zip, preserving the S3 path layout
    const zip = new JSZip();
    for (const k of files) {
      const res = await s3.send(
        new GetObjectCommand({ Bucket: DOCS_BUCKET, Key: k })
      );
      const bytes = (await res.Body?.transformToByteArray()) ?? new Uint8Array();
      zip.file(k, bytes);
    }

    const buffer = await zip.generateAsync({ type: "nodebuffer" });

    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `context101-export-${stamp}.zip`;

    // Node Buffer is compatible with the web Response body
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch (err) {
    console.error("zip failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
