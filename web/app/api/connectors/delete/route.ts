import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  DeleteCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import { DeleteSecretCommand } from "@aws-sdk/client-secrets-manager";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

import {
  CONNECTORS_TABLE,
  ddbConnectors,
  sm,
  type Connector,
} from "@/utils/connectors";
import { DOCS_BUCKET, s3 } from "@/utils/s3";

/**
 * POST /api/connectors/delete
 * Body: { id: string }
 *
 * Removes:
 *   - the connector row
 *   - the per-connection secret (force delete, no recovery window)
 *   - all S3 files under sources/<type>/<spreadsheet-slug>/
 */
export async function POST(request: NextRequest) {
  if (!CONNECTORS_TABLE || !DOCS_BUCKET) {
    return NextResponse.json(
      { error: "env vars not set" },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const got = await ddbConnectors.send(
      new GetCommand({ TableName: CONNECTORS_TABLE, Key: { id: body.id } })
    );
    const row = got.Item as Connector | undefined;
    if (!row) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    // 1. Delete all S3 files under this connector's prefix
    if (row.resource_title) {
      const slug = (row.resource_title ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64);
      const prefix = `sources/${row.type}/${slug || "item"}/`;

      let token: string | undefined;
      do {
        const list = await s3.send(
          new ListObjectsV2Command({
            Bucket: DOCS_BUCKET,
            Prefix: prefix,
            ContinuationToken: token,
          })
        );
        const keys = (list.Contents ?? [])
          .map((o) => o.Key)
          .filter((k): k is string => !!k);
        if (keys.length > 0) {
          await s3.send(
            new DeleteObjectsCommand({
              Bucket: DOCS_BUCKET,
              Delete: {
                Objects: keys.map((Key) => ({ Key })),
                Quiet: true,
              },
            })
          );
        }
        token = list.IsTruncated ? list.NextContinuationToken : undefined;
      } while (token);
    }

    // 2. Delete the refresh-token secret (force, no recovery window)
    if (row.token_secret_arn) {
      await sm
        .send(
          new DeleteSecretCommand({
            SecretId: row.token_secret_arn,
            ForceDeleteWithoutRecovery: true,
          })
        )
        .catch((e) => console.warn("token secret delete failed:", e));
    }

    // 3. Delete the connector row
    await ddbConnectors.send(
      new DeleteCommand({
        TableName: CONNECTORS_TABLE,
        Key: { id: body.id },
      })
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("connector delete failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
