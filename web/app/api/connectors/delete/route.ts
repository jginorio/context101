import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DeleteSecretCommand } from "@aws-sdk/client-secrets-manager";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

import {
  pgDeleteConnector,
  pgGetConnector,
  sm,
  toClientConnector,
} from "@/utils/connectors";
import { readAuthContext, resolveBrainFromRequest } from "@/lib/brains-server";
import { bucketForBrain, s3 } from "@/utils/s3";

/**
 * POST /api/connectors/delete[?brain=<id>]
 * Body: { id: string }
 *
 * Removes (in the active brain):
 *   - the connector row
 *   - the per-connection secret (force delete, no recovery window)
 *   - this connector's S3 files. Notion packs every connector in a workspace
 *     under one shared prefix (sources/notion/<workspace-slug>/), and GitHub
 *     packs every (possibly path-scoped) connector for a repo under
 *     sources/github/<repo-slug>/ — for both we delete only the objects this
 *     connector wrote (matched via the sidecar's connector_id). Google types
 *     use a per-resource prefix that belongs to a single connector, so a
 *     wholesale prefix delete is safe there.
 */
export async function POST(request: NextRequest) {
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const r = await resolveBrainFromRequest(request);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const docsBucket = bucketForBrain(r.brain);

  const body = await request.json().catch(() => null);
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const rowRaw = await pgGetConnector(auth.orgId, r.brain.brain_id, body.id);
    if (!rowRaw) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const row = toClientConnector(rowRaw);

    // 1. Delete this connector's S3 files.
    const slugify = (s: string) =>
      (s ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64);

    const deleteInBatches = async (keys: string[]) => {
      for (let i = 0; i < keys.length; i += 1000) {
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: docsBucket,
            Delete: {
              Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })),
              Quiet: true,
            },
          })
        );
      }
    };

    if (row.type === "notion" || row.type === "github") {
      // Shared prefixes: delete only the objects whose sidecar
      // connector_id matches this connector. Notion packs a workspace's
      // connectors under one prefix; GitHub packs a repo's (possibly
      // path-scoped) connectors under sources/github/<repo-slug>/ — so a
      // wholesale prefix delete would nuke sibling connectors' files.
      const prefix =
        row.type === "notion"
          ? row.notion_workspace_name
            ? `sources/notion/${slugify(row.notion_workspace_name) || "notion"}/`
            : "sources/notion/"
          : row.resource_title
            ? `sources/github/${slugify(row.resource_title) || "item"}/`
            : "sources/github/";
      const toDelete: string[] = [];
      let token: string | undefined;
      do {
        const list = await s3.send(
          new ListObjectsV2Command({
            Bucket: docsBucket,
            Prefix: prefix,
            ContinuationToken: token,
          })
        );
        for (const o of list.Contents ?? []) {
          const key = o.Key;
          if (!key || !key.endsWith(".md.metadata.json")) continue;
          try {
            const obj = await s3.send(
              new GetObjectCommand({ Bucket: docsBucket, Key: key })
            );
            const text = (await obj.Body?.transformToString()) ?? "{}";
            const cid = JSON.parse(text)?.metadataAttributes?.connector_id;
            if (cid === body.id) {
              toDelete.push(key); // the sidecar
              toDelete.push(key.replace(/\.metadata\.json$/, "")); // the .md
            }
          } catch (e) {
            console.warn(`sidecar read failed for ${key}:`, e);
          }
        }
        token = list.IsTruncated ? list.NextContinuationToken : undefined;
      } while (token);
      await deleteInBatches(toDelete);
    } else if (row.resource_title) {
      // Per-resource exclusive prefix — safe to delete wholesale.
      const slug = slugify(row.resource_title);
      const prefix = `sources/${row.type}/${slug || "item"}/`;
      let token: string | undefined;
      do {
        const list = await s3.send(
          new ListObjectsV2Command({
            Bucket: docsBucket,
            Prefix: prefix,
            ContinuationToken: token,
          })
        );
        const keys = (list.Contents ?? [])
          .map((o) => o.Key)
          .filter((k): k is string => !!k);
        await deleteInBatches(keys);
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
    await pgDeleteConnector(auth.orgId, r.brain.brain_id, body.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("connector delete failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
