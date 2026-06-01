/**
 * connector-sync-sheets Lambda
 *
 * Input: { connectorId: string }
 *
 * Flow:
 *   1. GetItem from connectors table to get spreadsheet_id, refresh_token_secret_arn
 *   2. Refresh the Google access token (OAuth 2.0 token endpoint)
 *   3. Read the spreadsheet's metadata (tab list + title)
 *   4. For each tab, fetch values and render to a markdown table
 *   5. Write sources/sheets/<spreadsheet-slug>/<tab-slug>.md to S3
 *      + a .metadata.json sidecar tagging source=sheets, connector_id=<id>
 *   6. Delete stale S3 files that no longer correspond to a tab
 *   7. Update the Dynamo row: status, last_synced_at, item_count, last_error
 */
import { createRequire } from "node:module";
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

// pg-http ships as a Lambda layer (zero-dependency Neon-over-HTTP helper).
// Connectors live in the Postgres `connectors` table; see lib/db/schema.ts.
const require = createRequire(import.meta.url);
const { pgFetchOne, pgExecute } = require("pg-http");

const s3 = new S3Client({});
const sm = new SecretsManagerClient({});

const DATABASE_URL = process.env.DATABASE_URL;
// The brain's docs bucket comes from the invocation event (dispatcher /
// web route inject it per row). Env-var fallback keeps legacy invokes
// against the default brain working.
let DOCS_BUCKET = process.env.DOCS_BUCKET;
const GOOGLE_OAUTH_CLIENT_SECRET_ID =
  process.env.GOOGLE_OAUTH_CLIENT_SECRET_ID;

const SOURCES_PREFIX = "sources/sheets/";

// ── Helpers ──────────────────────────────────────────────────────────

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

async function fetchSpreadsheet(accessToken, spreadsheetId) {
  // Include grid data = false to keep response small (we only need tab names here)
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=false`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    // The Sheets API rejects non-native files (uploaded .xlsx/.xlsm/.ods
    // stored in Drive but never converted to a Google Sheet) with
    // 400 FAILED_PRECONDITION "This operation is not supported for this
    // document". Translate to something actionable.
    if (
      r.status === 400 &&
      /not supported for this document/i.test(body)
    ) {
      throw new Error(
        "This looks like an uploaded Excel file (.xlsx/.xlsm/.ods), not a native Google Sheet. " +
          "In the Sheet, go File → Save as Google Sheets, then retry with the new URL."
      );
    }
    throw new Error(`spreadsheets.get failed ${r.status}: ${body}`);
  }
  return r.json();
}

// One Drive metadata GET for the source's true last-edited time + editor
// (the Sheets API doesn't return modifiedTime). Reuses the access token;
// best-effort. Feeds the wiki generator's "newer source wins" rule.
async function fetchDriveMeta(accessToken, fileId) {
  try {
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId
      )}?fields=modifiedTime,lastModifyingUser,webViewLink`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!r.ok) return {};
    const m = await r.json();
    return {
      source_modified_at: m.modifiedTime ?? null,
      source_author:
        m.lastModifyingUser?.displayName ??
        m.lastModifyingUser?.emailAddress ??
        null,
      source_url: m.webViewLink ?? null,
    };
  } catch {
    return {};
  }
}

async function fetchTabValues(accessToken, spreadsheetId, tabName) {
  // valueRenderOption=FORMATTED_VALUE gives us what the user sees
  const range = encodeURIComponent(`'${tabName.replace(/'/g, "''")}'`);
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}?valueRenderOption=FORMATTED_VALUE`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!r.ok) {
    throw new Error(
      `values.get failed for tab "${tabName}" ${r.status}: ${await r.text().catch(() => "")}`
    );
  }
  const j = await r.json();
  return j.values ?? []; // [][]string — rows of cells
}

function rowsToMarkdownTable(rows) {
  if (rows.length === 0) return "_(empty)_";
  const maxCols = Math.max(...rows.map((r) => r.length));
  const padded = rows.map((r) =>
    r.concat(Array(maxCols - r.length).fill(""))
  );
  const header = padded[0];
  const body = padded.slice(1);
  const esc = (c) => String(c ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const headerRow = `| ${header.map(esc).join(" | ")} |`;
  const sepRow = `| ${header.map(() => "---").join(" | ")} |`;
  const bodyRows = body.map((r) => `| ${r.map(esc).join(" | ")} |`);
  return [headerRow, sepRow, ...bodyRows].join("\n");
}

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

async function markSyncing(connectorId) {
  await pgExecute(
    DATABASE_URL,
    `update connectors set status = 'syncing', updated_at = now() where id = $1`,
    [connectorId]
  );
}

async function markError(connectorId, message) {
  await pgExecute(
    DATABASE_URL,
    `update connectors
       set status = 'error', last_error = $2, updated_at = now()
     where id = $1`,
    [connectorId, String(message).slice(0, 2000)]
  );
}

async function markSuccess(connectorId, itemCount, spreadsheetTitle) {
  await pgExecute(
    DATABASE_URL,
    `update connectors
       set status = 'connected',
           last_synced_at = now(),
           item_count = $2,
           last_error = null,
           metadata = metadata || $3::jsonb,
           updated_at = now()
     where id = $1`,
    [connectorId, itemCount, JSON.stringify({ resource_title: spreadsheetTitle })]
  );
}

// ── Handler ──────────────────────────────────────────────────────────

export const handler = async (event) => {
  const connectorId = event?.connectorId;
  if (!connectorId) throw new Error("connectorId is required");
  // Reset on every invocation — Lambda containers are reused across
  // invocations, so a conditional `if (event.X) X = …` would leave the
  // previous invocation's brain-scoped value in place when the next one
  // omits the field. Always pick from event ?? env, never from the
  // module-level state set by a prior call.
  DOCS_BUCKET = event?.docsBucket || process.env.DOCS_BUCKET;
  if (!DATABASE_URL || !DOCS_BUCKET || !GOOGLE_OAUTH_CLIENT_SECRET_ID) {
    throw new Error("required env vars missing");
  }

  await markSyncing(connectorId);

  try {
    const row = await pgFetchOne(
      DATABASE_URL,
      `select id, type, external_id, external_url, token_secret_arn
         from connectors where id = $1`,
      [connectorId]
    );
    if (!row) throw new Error(`connector ${connectorId} not found`);
    if (row.type !== "sheets")
      throw new Error(`wrong connector type: ${row.type}`);

    const spreadsheetId = row.external_id;
    if (!spreadsheetId) throw new Error("external_id missing");
    const tokenSecretArn = row.token_secret_arn;
    if (!tokenSecretArn) throw new Error("token_secret_arn missing");

    const tokenSecret = await getJson(tokenSecretArn);
    const refreshToken = tokenSecret.refresh_token;
    if (!refreshToken) throw new Error("refresh_token missing from secret");

    const accessToken = await refreshAccessToken(refreshToken);
    const meta = await fetchSpreadsheet(accessToken, spreadsheetId);
    const driveMeta = await fetchDriveMeta(accessToken, spreadsheetId);
    const title = meta.properties?.title ?? spreadsheetId;
    const spreadsheetSlug = slugify(title);
    const prefix = `${SOURCES_PREFIX}${spreadsheetSlug}/`;

    // Fetch + render each tab
    const tabs = (meta.sheets ?? [])
      .map((s) => s.properties?.title)
      .filter(Boolean);

    let totalRows = 0;
    const freshKeys = new Set();

    for (const tabName of tabs) {
      const values = await fetchTabValues(accessToken, spreadsheetId, tabName);
      totalRows += Math.max(0, values.length - 1);
      const tabSlug = slugify(tabName);
      const key = `${prefix}${tabSlug}.md`;

      const content = [
        `# ${title} — ${tabName}`,
        "",
        `Source: [Google Sheets](${row.external_url}) · Tab **${tabName}** · ${Math.max(0, values.length - 1)} data row(s) · last synced ${new Date().toISOString()}`,
        "",
        rowsToMarkdownTable(values),
        "",
      ].join("\n");

      await putMarkdown(key, content);
      await putSidecar(key, {
        metadataAttributes: {
          source: "sheets",
          connector_id: connectorId,
          spreadsheet_id: spreadsheetId,
          tab_name: tabName,
          last_synced: new Date().toISOString(),
          source_modified_at: driveMeta.source_modified_at ?? null,
          source_author: driveMeta.source_author ?? null,
          source_url: driveMeta.source_url ?? row.external_url ?? null,
        },
      });
      freshKeys.add(key);
      freshKeys.add(`${key}.metadata.json`);
    }

    // Clean up any stale files from a previous sync (tabs renamed/removed)
    const existing = await listKeysUnder(prefix);
    const stale = existing.filter((k) => !freshKeys.has(k));
    await deleteKeys(stale);

    await markSuccess(connectorId, totalRows, title);
    return { ok: true, tabs: tabs.length, rows: totalRows, title };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`sync ${connectorId} failed:`, err);
    await markError(connectorId, msg);
    throw err;
  }
};
