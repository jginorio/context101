/**
 * connector-sync-docs Lambda
 *
 * Input: { connectorId: string }
 *
 * Fetches a Google Doc via docs.googleapis.com, renders the structured
 * content into markdown, and writes it to:
 *   sources/docs/<doc-slug>/content.md
 *   sources/docs/<doc-slug>/content.md.metadata.json
 *
 * Rendering is intentionally simple:
 *   - Headings (HEADING_1..HEADING_6) -> # .. ######
 *   - Titles/subtitles               -> # / ##
 *   - Bulleted/numbered lists        -> "- " / "1. "
 *   - Tables                         -> markdown tables (cells joined into one line)
 *   - Inline formatting              -> dropped (bold/italic don't matter for RAG)
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

// Per-brain values come from the invocation event (dispatcher injects
// per-row). Env-var fallbacks keep legacy invokes against the default
// brain working.
let CONNECTORS_TABLE = process.env.CONNECTORS_TABLE;
let DOCS_BUCKET = process.env.DOCS_BUCKET;
const GOOGLE_OAUTH_CLIENT_SECRET_ID =
  process.env.GOOGLE_OAUTH_CLIENT_SECRET_ID;

const SOURCES_PREFIX = "sources/docs/";

function slugify(s) {
  return (
    s
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

async function refreshAccessToken(refreshToken) {
  const { client_id, client_secret } = await getJson(
    GOOGLE_OAUTH_CLIENT_SECRET_ID
  );
  const body = new URLSearchParams({
    client_id,
    client_secret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `token refresh failed ${res.status}: ${await res.text().catch(() => "")}`
    );
  }
  const j = await res.json();
  return j.access_token;
}

async function fetchDoc(accessToken, documentId) {
  const r = await fetch(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    if (r.status === 400 && /not supported for this document/i.test(body)) {
      throw new Error(
        "This looks like an uploaded Word file (.docx/.doc), not a native Google Doc. " +
          "In the doc, go File → Save as Google Docs, then retry with the new URL."
      );
    }
    throw new Error(`documents.get failed ${r.status}: ${body}`);
  }
  return r.json();
}

// ── Renderer ─────────────────────────────────────────────────────────

function paragraphText(paragraph) {
  const parts = [];
  for (const el of paragraph.elements ?? []) {
    if (el.textRun?.content) parts.push(el.textRun.content);
    // Ignore personLinks, richLinks, equations, etc.
  }
  return parts.join("").replace(/\n+$/g, "");
}

function headingPrefix(style) {
  switch (style) {
    case "TITLE":
      return "# ";
    case "SUBTITLE":
      return "## ";
    case "HEADING_1":
      return "# ";
    case "HEADING_2":
      return "## ";
    case "HEADING_3":
      return "### ";
    case "HEADING_4":
      return "#### ";
    case "HEADING_5":
      return "##### ";
    case "HEADING_6":
      return "###### ";
    default:
      return null;
  }
}

function renderParagraph(paragraph, lists) {
  const text = paragraphText(paragraph);
  if (!text.trim()) return "";

  const ns = paragraph.paragraphStyle?.namedStyleType;
  const hp = headingPrefix(ns);
  if (hp) return `${hp}${text}`;

  const bullet = paragraph.bullet;
  if (bullet) {
    const listId = bullet.listId;
    const nest = bullet.nestingLevel ?? 0;
    const indent = "  ".repeat(nest);
    const glyph = lists?.[listId]?.listProperties?.nestingLevels?.[nest]?.glyphType;
    // glyphType is something like DECIMAL/UPPER_ALPHA when numbered; absent on bullets
    const marker =
      glyph && !/NONE|GLYPH_UNSPECIFIED/.test(glyph) ? "1." : "-";
    return `${indent}${marker} ${text}`;
  }

  return text;
}

function renderTable(table, lists) {
  const rows = table.tableRows ?? [];
  if (rows.length === 0) return "";
  const cellText = (cell) =>
    (cell.content ?? [])
      .map((se) =>
        se.paragraph ? paragraphText(se.paragraph) : ""
      )
      .join(" ")
      .replace(/\s+/g, " ")
      .replace(/\|/g, "\\|")
      .trim();

  const matrix = rows.map((r) => (r.tableCells ?? []).map(cellText));
  const maxCols = Math.max(...matrix.map((r) => r.length));
  const padded = matrix.map((r) =>
    r.concat(Array(maxCols - r.length).fill(""))
  );
  const [header, ...body] = padded;
  // If the doc has a single-row table, still emit a valid markdown table.
  const headerRow = `| ${header.join(" | ")} |`;
  const sepRow = `| ${header.map(() => "---").join(" | ")} |`;
  const bodyRows = body.map((r) => `| ${r.join(" | ")} |`);
  return [headerRow, sepRow, ...bodyRows].join("\n");
  // `lists` unused here but kept for future use (nested lists in cells).
  void lists;
}

function renderBody(doc) {
  const content = doc.body?.content ?? [];
  const lists = doc.lists ?? {};
  const lines = [];
  for (const se of content) {
    if (se.paragraph) {
      const line = renderParagraph(se.paragraph, lists);
      lines.push(line);
    } else if (se.table) {
      lines.push("");
      lines.push(renderTable(se.table, lists));
      lines.push("");
    } else if (se.sectionBreak) {
      lines.push("");
    }
  }
  // Collapse 3+ blank lines to 2
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
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
        ":e": message.slice(0, 2000),
        ":t": new Date().toISOString(),
      },
    })
  );
}

async function markSuccess(connectorId, itemCount, docTitle) {
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
        ":rt": docTitle,
      },
    })
  );
}

// ── Handler ──────────────────────────────────────────────────────────

export const handler = async (event) => {
  const connectorId = event?.connectorId;
  if (!connectorId) throw new Error("connectorId is required");
  if (event?.connectorsTable) CONNECTORS_TABLE = event.connectorsTable;
  if (event?.docsBucket) DOCS_BUCKET = event.docsBucket;
  if (!CONNECTORS_TABLE || !DOCS_BUCKET || !GOOGLE_OAUTH_CLIENT_SECRET_ID) {
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
    if (row.type !== "docs")
      throw new Error(`wrong connector type: ${row.type}`);

    const documentId = row.resource_id;
    if (!documentId) throw new Error("resource_id missing");
    const tokenSecretArn = row.token_secret_arn;
    if (!tokenSecretArn) throw new Error("token_secret_arn missing");

    const tokenSecret = await getJson(tokenSecretArn);
    const refreshToken = tokenSecret.refresh_token;
    if (!refreshToken) throw new Error("refresh_token missing from secret");

    const accessToken = await refreshAccessToken(refreshToken);
    const doc = await fetchDoc(accessToken, documentId);
    const title = doc.title ?? documentId;
    const docSlug = slugify(title);
    const prefix = `${SOURCES_PREFIX}${docSlug}/`;
    const key = `${prefix}content.md`;

    const rendered = renderBody(doc);
    // Rough "item count" = non-empty lines, so users see *something* move
    const itemCount = rendered.split("\n").filter((l) => l.trim()).length;

    const content = [
      `# ${title}`,
      "",
      `Source: [Google Docs](${row.resource_url}) · last synced ${new Date().toISOString()}`,
      "",
      rendered,
      "",
    ].join("\n");

    await putMarkdown(key, content);
    await putSidecar(key, {
      metadataAttributes: {
        source: "docs",
        connector_id: connectorId,
        document_id: documentId,
        last_synced: new Date().toISOString(),
      },
    });

    // Clean up stale keys if the doc was previously synced under a
    // different title (title change → different slug → stale folder).
    const existing = await listKeysUnder(SOURCES_PREFIX);
    const stale = existing.filter((k) => {
      if (k === key || k === `${key}.metadata.json`) return false;
      // Only prune folders whose sidecar belongs to *this* connector
      return false; // conservative: don't sweep across connectors here
    });
    await deleteKeys(stale);

    await markSuccess(connectorId, itemCount, title);
    return { ok: true, title, lines: itemCount };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`docs sync ${connectorId} failed:`, err);
    await markError(connectorId, msg);
    throw err;
  }
};
