/**
 * connector-sync-notion Lambda
 *
 * Input: { connectorId: string }
 *
 * Fetches a Notion page (or every page in a database) via the Notion
 * API, walks each page's block tree recursively, renders to markdown, and
 * crawls nested pages (child pages + child-database rows) so the whole
 * connected subtree is synced — not just the top page.
 *
 * S3 layout:
 *   sources/notion/<workspace-slug>/<page-slug>.md
 *   sources/notion/<workspace-slug>/<page-slug>.md.metadata.json
 *
 * Notion OAuth issues a long-lived access_token (no refresh). We store
 *   { access_token, workspace_id, workspace_name, bot_id }
 * in the per-connector secret and reuse it every sync.
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
// The brain's docs bucket comes from the invocation event; env-var
// fallback keeps legacy invokes against the default brain working.
let DOCS_BUCKET = process.env.DOCS_BUCKET;
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

async function notionFetch(token, path, init = {}, attempt = 0) {
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
    // Recursive crawling fans out a lot of requests; back off on rate limits
    // (429) and transient 5xx instead of failing the whole sync.
    if ((r.status === 429 || r.status >= 500) && attempt < 5) {
      const retryAfter = Number(r.headers.get("retry-after"));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(8000, 500 * 2 ** attempt);
      await new Promise((res) => setTimeout(res, waitMs));
      return notionFetch(token, path, init, attempt + 1);
    }
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

// Extract a page's Notion icon for the sidebar. Emojis are stable; custom
// image icons use Notion-hosted URLs (external is stable, file URLs are
// short-lived presigned links — fine for display between syncs).
function pageIcon(page) {
  const ic = page?.icon;
  if (!ic) return null;
  if (ic.type === "emoji" && ic.emoji) return { type: "emoji", value: ic.emoji };
  if (ic.type === "external" && ic.external?.url)
    return { type: "url", value: ic.external.url };
  if (ic.type === "file" && ic.file?.url)
    return { type: "url", value: ic.file.url };
  return null;
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

async function renderBlocks(token, blocks, depth = 0, discovered = null, linkBase = "") {
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
      case "child_page": {
        const childTitle = data.title || "Child page";
        // Link to the child's own synced doc (its key is <linkBase><slug>.md,
        // matching the handler's per-page key) so the UI can open it in a tab.
        // Fall back to a plain marker if we don't have the base prefix.
        if (linkBase) {
          lines.push(
            `${indent}- 📄 [${childTitle}](${linkBase}${slugify(childTitle)}.md)`
          );
        } else {
          lines.push(`${indent}- 📄 *${childTitle}*`);
        }
        // A child_page block's id IS the subpage's page id — queue it so the
        // handler crawls the nested page as its own document.
        if (discovered) discovered.push({ id: b.id, type: "page" });
        break;
      }
      case "child_database":
        lines.push(`${indent}- 🗃️ *${data.title || "Child database"}*`);
        if (discovered) discovered.push({ id: b.id, type: "database" });
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
      const childLines = await renderBlocks(
        token,
        children,
        depth + 1,
        discovered,
        linkBase
      );
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

async function markSuccess(connectorId, itemCount, title, extraMeta = {}) {
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
    [
      connectorId,
      itemCount,
      JSON.stringify({ resource_title: title, ...extraMeta }),
    ]
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
  // Reset on every invocation — Lambda containers are reused across
  // invocations, so a conditional `if (event.X) X = …` would leave the
  // previous invocation's brain-scoped value in place when the next one
  // omits the field. Always pick from event ?? env, never from the
  // module-level state set by a prior call.
  DOCS_BUCKET = event?.docsBucket || process.env.DOCS_BUCKET;
  if (!DATABASE_URL || !DOCS_BUCKET) {
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
    if (row.type !== "notion")
      throw new Error(`wrong connector type: ${row.type}`);

    const resourceId = row.external_id;
    if (!resourceId) throw new Error("external_id missing");
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

    // Crawl the connected page (or database) and every Notion page nested
    // beneath it — child pages, and the rows of any child databases. BFS with
    // a visited set guards against cycles; MAX_PAGES bounds runtime so a huge
    // space can't blow past the Lambda timeout.
    const MAX_PAGES = 500;
    const norm = (x) => String(x || "").replace(/-/g, "");
    const visited = new Set();

    // Build a Notion-style hierarchy (page icons + nesting) for the sidebar
    // as we crawl. Each node: { id, title, key, icon, children }.
    const nodes = new Map(); // normId -> node
    let rootNode = null;

    const queue = [];
    if (kind === "page") {
      queue.push({ page: resource, parentId: null });
    } else {
      visited.add(norm(resourceId));
      rootNode = {
        id: resourceId,
        title: topTitle,
        key: null, // a database has no page body of its own
        icon: pageIcon(resource),
        children: [],
      };
      nodes.set(norm(resourceId), rootNode);
      for (const r of await queryDatabasePages(accessToken, resourceId)) {
        queue.push({ page: r, parentId: resourceId });
      }
    }

    const freshKeys = new Set();
    const usedSlugs = new Set();
    let totalBlocks = 0;
    let truncated = false;
    // Set if any page failed to fetch this run. A partial crawl must NOT prune
    // (freshKeys would be missing still-valid pages → we'd delete good docs).
    let partial = false;

    // Keep S3 keys stable but unique: prefer the title slug, and only fall
    // back to an id suffix when two pages would collide on the same slug.
    const uniqueKey = (title, id) => {
      const base = slugify(title);
      let slug = base;
      if (usedSlugs.has(slug)) slug = `${base}-${norm(id).slice(-8)}`;
      usedSlugs.add(slug);
      return `${prefix}${slug}.md`;
    };

    while (queue.length) {
      if (usedSlugs.size >= MAX_PAGES) {
        truncated = true;
        break;
      }
      const { page, parentId } = queue.shift();
      if (visited.has(norm(page.id))) continue;
      visited.add(norm(page.id));

      const title = pageTitle(page);
      const key = uniqueKey(title, page.id);

      // Record this page in the hierarchy under its parent.
      const node = {
        id: page.id,
        title,
        key,
        icon: pageIcon(page),
        children: [],
      };
      nodes.set(norm(page.id), node);
      if (parentId == null) {
        rootNode = node;
      } else {
        nodes.get(norm(parentId))?.children.push(node);
      }

      const discovered = [];
      const topBlocks = await fetchBlockChildren(accessToken, page.id);
      totalBlocks += topBlocks.length;
      const rendered = await renderBlocks(
        accessToken,
        topBlocks,
        0,
        discovered,
        prefix
      );

      const content = [
        `# ${title}`,
        "",
        `Source: [Notion](${page.url ?? row.external_url}) · workspace **${workspaceName}** · last synced ${new Date().toISOString()}`,
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
          kind: "page",
          last_synced: new Date().toISOString(),
        },
      });
      freshKeys.add(key);
      freshKeys.add(`${key}.metadata.json`);

      // Enqueue nested pages / database rows discovered while rendering.
      for (const d of discovered) {
        if (visited.has(norm(d.id))) continue;
        try {
          if (d.type === "page") {
            queue.push({
              page: await fetchPage(accessToken, d.id),
              parentId: page.id,
            });
          } else if (d.type === "database") {
            visited.add(norm(d.id));
            for (const r of await queryDatabasePages(accessToken, d.id)) {
              queue.push({ page: r, parentId: page.id });
            }
          }
        } catch (e) {
          // Child not shared with the integration, or a transient failure
          // (rate limit, 5xx). Skip it instead of failing the whole sync, but
          // mark the crawl partial so we don't prune away pages we just failed
          // to re-fetch.
          partial = true;
          console.warn(`notion: skip child ${d.type} ${d.id}: ${e.message}`);
        }
      }
    }

    const pageCount = usedSlugs.size;

    // Prune stale keys from a previous sync (page renamed / removed). CRITICAL:
    // only prune after a COMPLETE crawl. If any page failed to fetch or the
    // crawl was truncated, freshKeys is missing pages that still exist — and
    // pruning then would delete good, still-valid docs (this previously caused
    // "key does not exist" after a flaky sync). Skip the prune in that case.
    if (!partial && !truncated) {
      const existing = await listKeysUnder(prefix);
      const stale = existing.filter((k) => !freshKeys.has(k));
      await deleteKeys(stale);
    } else {
      console.warn(
        `notion: partial crawl (partial=${partial}, truncated=${truncated}) — skipping prune to avoid deleting pages that didn't sync this run`
      );
    }

    await markSuccess(
      connectorId,
      pageCount,
      topTitle,
      rootNode ? { notion_tree: rootNode } : {}
    );
    return { ok: true, kind, pages: pageCount, blocks: totalBlocks, truncated };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`notion sync ${connectorId} failed:`, err);
    await markError(connectorId, msg);
    throw err;
  }
};
