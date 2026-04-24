/**
 * connector-sync-notion Lambda
 *
 * Input: { connectorId: string }
 *
 * Fetches a Notion page (or every page in a database) via the Notion
 * API, walks each page's block tree recursively, and renders to markdown.
 *
 * S3 layout:
 *   sources/notion/<workspace-slug>/<page-slug>.md
 *   sources/notion/<workspace-slug>/<page-slug>.md.metadata.json
 *
 * Notion OAuth issues a long-lived access_token (no refresh). We store
 *   { access_token, workspace_id, workspace_name, bot_id }
 * in the per-connector secret and reuse it every sync.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const sm = new SecretsManagerClient({});

const CONNECTORS_TABLE = process.env.CONNECTORS_TABLE;
const DOCS_BUCKET = process.env.DOCS_BUCKET;
const NOTION_VERSION = "2022-06-28";

const SOURCES_PREFIX = "sources/notion/";

function slugify(s) {
  return (
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "item"
  );
}

async function getJson(secretId) {
  const r = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
  return JSON.parse(r.SecretString ?? "{}");
}

// ── Notion API ───────────────────────────────────────────────────────

async function notionFetch(token, path, init = {}) {
  const r = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    const e = new Error(`notion ${path} ${r.status}: ${body}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

async function fetchPage(token, id) {
  return notionFetch(token, `/pages/${id}`);
}

async function fetchDatabase(token, id) {
  return notionFetch(token, `/databases/${id}`);
}

async function queryDatabasePages(token, id) {
  const pages = [];
  let cursor;
  do {
    const body = cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 };
    const j = await notionFetch(token, `/databases/${id}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    pages.push(...(j.results || []));
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor);
  return pages;
}

async function fetchBlockChildren(token, blockId) {
  const blocks = [];
  let cursor;
  do {
    const qs = new URLSearchParams({ page_size: "100" });
    if (cursor) qs.set("start_cursor", cursor);
    const j = await notionFetch(token, `/blocks/${blockId}/children?${qs}`);
    blocks.push(...(j.results || []));
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor);
  return blocks;
}

// ── Rendering ────────────────────────────────────────────────────────

function richText(arr) {
  return (arr || []).map((r) => r.plain_text ?? "").join("");
}

function pageTitle(page) {
  // A page from pages.retrieve has properties; find the `title` type.
  const props = page.properties || {};
  for (const k of Object.keys(props)) {
    const p = props[k];
    if (p.type === "title") return richText(p.title) || "Untitled";
  }
  // Fallback for database objects
  if (page.title) return richText(page.title) || "Untitled";
  return "Untitled";
}

async function renderBlocks(token, blocks, depth = 0) {
  const lines = [];
  const indent = "  ".repeat(depth);
  let numberedCounter = 0;

  for (const b of blocks) {
    const t = b.type;
    const data = b[t] || {};

    // Reset numbered counter when we leave a numbered-list run
    if (t !== "numbered_list_item") numberedCounter = 0;

    switch (t) {
      case "paragraph": {
        const txt = richText(data.rich_text);
        if (txt.trim()) lines.push(`${indent}${txt}`);
        break;
      }
      case "heading_1":
        lines.push(`${indent}# ${richText(data.rich_text)}`);
        break;
      case "heading_2":
        lines.push(`${indent}## ${richText(data.rich_text)}`);
        break;
      case "heading_3":
        lines.push(`${indent}### ${richText(data.rich_text)}`);
        break;
      case "bulleted_list_item":
        lines.push(`${indent}- ${richText(data.rich_text)}`);
        break;
      case "numbered_list_item":
        numberedCounter += 1;
        lines.push(`${indent}${numberedCounter}. ${richText(data.rich_text)}`);
        break;
      case "to_do":
        lines.push(
          `${indent}- [${data.checked ? "x" : " "}] ${richText(data.rich_text)}`
        );
        break;
      case "toggle":
        lines.push(`${indent}- ${richText(data.rich_text)}`);
        break;
      case "quote":
        lines.push(`${indent}> ${richText(data.rich_text)}`);
        break;
      case "callout": {
        const icon = data.icon?.emoji ? `${data.icon.emoji} ` : "";
        lines.push(`${indent}> ${icon}${richText(data.rich_text)}`);
        break;
      }
      case "code": {
        const lang = data.language || "";
        lines.push(`${indent}\`\`\`${lang}`);
        for (const line of richText(data.rich_text).split("\n"))
          lines.push(`${indent}${line}`);
        lines.push(`${indent}\`\`\``);
        break;
      }
      case "divider":
        lines.push(`${indent}---`);
        break;
      case "bookmark":
      case "embed":
      case "link_preview":
      case "video":
      case "file":
      case "pdf":
        if (data.url) lines.push(`${indent}[${data.url}](${data.url})`);
        break;
      case "image": {
        const url = data.file?.url || data.external?.url;
        const cap = richText(data.caption) || "image";
        if (url) lines.push(`${indent}![${cap}](${url})`);
        break;
      }
      case "equation":
        if (data.expression) lines.push(`${indent}$${data.expression}$`);
        break;
      case "table": {
        // Children are table_row blocks
        const rows = b.has_children ? await fetchBlockChildren(token, b.id) : [];
        const matrix = rows.map((r) =>
          (r.table_row?.cells || []).map((cell) =>
            richText(cell).replace(/\|/g, "\\|").replace(/\n/g, " ")
          )
        );
        if (matrix.length) {
          const cols = Math.max(...matrix.map((r) => r.length));
          const padded = matrix.map((r) =>
            r.concat(Array(cols - r.length).fill(""))
          );
          const [header, ...body] = padded;
          lines.push(`${indent}| ${header.join(" | ")} |`);
          lines.push(`${indent}| ${header.map(() => "---").join(" | ")} |`);
          for (const row of body) lines.push(`${indent}| ${row.join(" | ")} |`);
        }
        // Table rows are rendered here — don't recurse into children.
        continue;
      }
      case "child_page":
        lines.push(`${indent}- 📄 *${data.title || "Child page"}*`);
        break;
      case "child_database":
        lines.push(`${indent}- 🗃️ *${data.title || "Child database"}*`);
        break;
      case "synced_block":
      case "column_list":
      case "column":
        // Just recurse into children below; no marker line.
        break;
      default:
        // Unknown block type — emit a best-effort line if there's rich_text
        if (data.rich_text) {
          const t2 = richText(data.rich_text);
          if (t2.trim()) lines.push(`${indent}${t2}`);
        }
    }

    // Recurse for nested children (bulleted lists, toggles, callouts, etc)
    if (
      b.has_children &&
      t !== "table" &&
      t !== "child_page" &&
      t !== "child_database"
    ) {
      const children = await fetchBlockChildren(token, b.id);
      const childLines = await renderBlocks(token, children, depth + 1);
      if (childLines) lines.push(childLines);
    }
  }

  return lines.join("\n");
}

// ── S3 helpers ───────────────────────────────────────────────────────

async function putMarkdown(key, content) {
  await s3.send(
    new PutObjectCommand({
      Bucket: DOCS_BUCKET,
      Key: key,
      Body: content,
      ContentType: "text/markdown; charset=utf-8",
    })
  );
}

async function putSidecar(key, sidecar) {
  await s3.send(
    new PutObjectCommand({
      Bucket: DOCS_BUCKET,
      Key: `${key}.metadata.json`,
      Body: JSON.stringify(sidecar, null, 2),
      ContentType: "application/json",
    })
  );
}

async function listKeysUnder(prefix) {
  const keys = [];
  let token;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({
        Bucket: DOCS_BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      })
    );
    for (const o of r.Contents ?? []) if (o.Key) keys.push(o.Key);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function deleteKeys(keys) {
  if (keys.length === 0) return;
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000).map((Key) => ({ Key }));
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: DOCS_BUCKET,
        Delete: { Objects: batch, Quiet: true },
      })
    );
  }
}

async function markError(connectorId, message) {
  await ddb.send(
    new UpdateCommand({
      TableName: CONNECTORS_TABLE,
      Key: { id: connectorId },
      UpdateExpression: "SET #s = :s, last_error = :e, last_error_at = :t",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":s": "error",
        ":e": String(message).slice(0, 2000),
        ":t": new Date().toISOString(),
      },
    })
  );
}

async function markSuccess(connectorId, itemCount, title) {
  await ddb.send(
    new UpdateCommand({
      TableName: CONNECTORS_TABLE,
      Key: { id: connectorId },
      UpdateExpression:
        "SET #s = :s, last_synced_at = :t, item_count = :c, resource_title = :rt REMOVE last_error, last_error_at",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":s": "connected",
        ":t": new Date().toISOString(),
        ":c": itemCount,
        ":rt": title,
      },
    })
  );
}

// ── Resource kind detection ──────────────────────────────────────────

/**
 * Given a resource_id the UI parsed from a Notion URL, figure out if
 * it's a page or a database. Returns { kind: "page"|"database", resource }.
 * Falls back: try page first (most common), then database.
 */
async function resolveResource(token, id) {
  try {
    const page = await fetchPage(token, id);
    return { kind: "page", resource: page };
  } catch (e) {
    if (e.status !== 404 && e.status !== 400) throw e;
  }
  const db = await fetchDatabase(token, id);
  return { kind: "database", resource: db };
}

// ── Handler ──────────────────────────────────────────────────────────

export const handler = async (event) => {
  const connectorId = event?.connectorId;
  if (!connectorId) throw new Error("connectorId is required");
  if (!CONNECTORS_TABLE || !DOCS_BUCKET) {
    throw new Error("required env vars missing");
  }

  await ddb.send(
    new UpdateCommand({
      TableName: CONNECTORS_TABLE,
      Key: { id: connectorId },
      UpdateExpression: "SET #s = :s",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":s": "syncing" },
    })
  );

  try {
    const got = await ddb.send(
      new GetCommand({ TableName: CONNECTORS_TABLE, Key: { id: connectorId } })
    );
    const row = got.Item;
    if (!row) throw new Error(`connector ${connectorId} not found`);
    if (row.type !== "notion")
      throw new Error(`wrong connector type: ${row.type}`);

    const resourceId = row.resource_id;
    if (!resourceId) throw new Error("resource_id missing");
    const tokenSecretArn = row.token_secret_arn;
    if (!tokenSecretArn) throw new Error("token_secret_arn missing");

    const tokenSecret = await getJson(tokenSecretArn);
    const accessToken = tokenSecret.access_token;
    if (!accessToken) throw new Error("access_token missing from secret");

    const workspaceName = tokenSecret.workspace_name || "notion";
    const workspaceSlug = slugify(workspaceName);
    const prefix = `${SOURCES_PREFIX}${workspaceSlug}/`;

    const { kind, resource } = await resolveResource(accessToken, resourceId);
    const topTitle =
      kind === "page" ? pageTitle(resource) : richText(resource.title) || "Untitled database";

    // Build the list of pages to render
    const pages =
      kind === "page"
        ? [resource]
        : await queryDatabasePages(accessToken, resourceId);

    const freshKeys = new Set();
    let totalBlocks = 0;

    for (const page of pages) {
      const title = pageTitle(page);
      const pageSlug = slugify(title);
      const key = `${prefix}${pageSlug}.md`;

      const topBlocks = await fetchBlockChildren(accessToken, page.id);
      totalBlocks += topBlocks.length;
      const rendered = await renderBlocks(accessToken, topBlocks);

      const content = [
        `# ${title}`,
        "",
        `Source: [Notion](${page.url ?? row.resource_url}) · workspace **${workspaceName}** · last synced ${new Date().toISOString()}`,
        "",
        rendered,
        "",
      ].join("\n");

      await putMarkdown(key, content);
      await putSidecar(key, {
        metadataAttributes: {
          source: "notion",
          connector_id: connectorId,
          notion_page_id: page.id,
          notion_workspace: workspaceName,
          kind,
          last_synced: new Date().toISOString(),
        },
      });
      freshKeys.add(key);
      freshKeys.add(`${key}.metadata.json`);
    }

    // Prune stale keys from a previous sync (page renamed, or database rows removed)
    const existing = await listKeysUnder(prefix);
    const stale = existing.filter((k) => !freshKeys.has(k));
    await deleteKeys(stale);

    await markSuccess(connectorId, pages.length, topTitle);
    return { ok: true, kind, pages: pages.length, blocks: totalBlocks };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`notion sync ${connectorId} failed:`, err);
    await markError(connectorId, msg);
    throw err;
  }
};
