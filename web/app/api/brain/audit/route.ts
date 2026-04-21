import {
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

import { DOCS_BUCKET, s3 } from "@/utils/s3";
import { auditBrain } from "@/utils/bedrock";

export const maxDuration = 180; // audit + opus call can take a couple min

/**
 * POST /api/brain/audit
 *
 * Reads every .md file in the docs bucket and sends the corpus to
 * Claude Opus 4.7, asking for cross-document findings (overlaps,
 * missing cross-references, inconsistencies, consolidation hints).
 *
 * Returns: { findings: Finding[] }
 */
export async function POST() {
  if (!DOCS_BUCKET) {
    return NextResponse.json(
      { error: "DOCS_BUCKET env var is not set" },
      { status: 500 }
    );
  }

  try {
    // List all markdown files in the bucket (paginated)
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
      return NextResponse.json({ findings: [] });
    }

    // Fetch each file's content in parallel
    const files = await Promise.all(
      keys.map(async (k) => {
        const obj = await s3.send(
          new GetObjectCommand({ Bucket: DOCS_BUCKET, Key: k })
        );
        const content = (await obj.Body?.transformToString("utf-8")) ?? "";
        return { path: k, content };
      })
    );

    const findings = await auditBrain(files);
    return NextResponse.json({ findings, fileCount: files.length });
  } catch (err) {
    console.error("audit failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
