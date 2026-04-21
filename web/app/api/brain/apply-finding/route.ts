import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { DOCS_BUCKET, s3 } from "@/utils/s3";
import { applyFinding, type Finding } from "@/utils/bedrock";

export const maxDuration = 120;

/**
 * POST /api/brain/apply-finding
 * Body: { finding: Finding }
 *
 * Loads the files the finding implicates, sends them + the finding to
 * Claude Opus with a surgical prompt, and returns the proposed new
 * contents for each affected file. Does NOT write anything to S3 —
 * the UI shows a diff and hits /api/files/put for each file the user
 * accepts.
 */
export async function POST(request: NextRequest) {
  if (!DOCS_BUCKET) {
    return NextResponse.json(
      { error: "DOCS_BUCKET env var is not set" },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.finding !== "object") {
    return NextResponse.json({ error: "finding is required" }, { status: 400 });
  }
  const finding = body.finding as Finding;
  if (!Array.isArray(finding.file_paths) || finding.file_paths.length === 0) {
    return NextResponse.json(
      { error: "finding.file_paths must be a non-empty array" },
      { status: 400 }
    );
  }
  if (finding.file_paths.some((p) => typeof p !== "string" || p.includes(".."))) {
    return NextResponse.json({ error: "invalid path in finding" }, { status: 400 });
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

    const applied = await applyFinding(finding, files);

    // Build a response that pairs each proposed new_content with its
    // original so the UI can render diffs without re-fetching.
    const diffs = applied.files.map((a) => {
      const src = files.find((f) => f.path === a.path);
      return {
        path: a.path,
        original_content: src?.content ?? "",
        new_content: a.new_content,
        changed: !!src && src.content !== a.new_content,
      };
    });

    return NextResponse.json({ diffs });
  } catch (err) {
    console.error("apply-finding failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
