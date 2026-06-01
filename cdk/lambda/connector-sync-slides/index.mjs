/**
 * connector-sync-slides Lambda
 *
 * Input: { connectorId: string }
 *
 * Fetches a Google Slides deck via slides.googleapis.com and renders each
 * slide's text content to markdown. Written to:
 *   sources/slides/<deck-slug>/content.md
 *   sources/slides/<deck-slug>/content.md.metadata.json
 *
 * Rendering strategy per slide:
 *   - "## Slide N — <heuristic title>"
 *   - Bullet the remaining text blocks (lines within a shape's textElements)
 *   - Speaker notes (if any) appended as "**Notes:** …"
 */
import { createRequire } from "node:module";
import {
  S3Client,
  PutObjectCommand,
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
const GOOGLE_OAUTH_CLIENT_SECRET_ID =
  process.env.GOOGLE_OAUTH_CLIENT_SECRET_ID;

const SOURCES_PREFIX = "sources/slides/";

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

async function fetchPresentation(accessToken, presentationId) {
  const r = await fetch(
    `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(presentationId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    if (r.status === 400 && /not supported for this document/i.test(body)) {
      throw new Error(
        "This looks like an uploaded PowerPoint file (.pptx), not a native Google Slides deck. " +
          "In the deck, go File → Save as Google Slides, then retry with the new URL."
      );
    }
    throw new Error(`presentations.get failed ${r.status}: ${body}`);
  }
  return r.json();
}

// One Drive metadata GET for the source's true last-edited time + editor
// (the Slides API doesn't return modifiedTime). Reuses the access token;
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

// ── Renderer ─────────────────────────────────────────────────────────

function shapeLines(shape) {
  const textEls = shape?.text?.textElements ?? [];
  // Concatenate textRun content; `\v` (vertical tab) is a soft line break
  // in Slides — treat it like a newline.
  const raw = textEls
    .map((e) => e.textRun?.content ?? "")
    .join("")
    .replace(/\v/g, "\n");
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function isTitlePlaceholder(shape) {
  const t = shape?.placeholder?.type;
  return t === "TITLE" || t === "CENTERED_TITLE" || t === "SUBTITLE";
}

function renderSlide(slide, index) {
  const shapes = (slide.pageElements ?? []).filter((e) => e.shape);

  // Title: prefer a title placeholder, else the first non-empty text block
  let title = null;
  const titleShape = shapes.find((e) => isTitlePlaceholder(e.shape));
  if (titleShape) {
    const lines = shapeLines(titleShape.shape);
    if (lines.length) title = lines.join(" ");
  }
  let bodyShapes = shapes.filter((e) => e !== titleShape);
  if (!title) {
    for (let i = 0; i < bodyShapes.length; i++) {
      const lines = shapeLines(bodyShapes[i].shape);
      if (lines.length) {
        title = lines[0];
        // Include rest of that shape as body, drop the first line
        const rest = lines.slice(1);
        bodyShapes = [
          { shape: { text: { textElements: rest.map((l) => ({ textRun: { content: l + "\n" } })) } } },
          ...bodyShapes.filter((_, j) => j !== i),
        ];
        break;
      }
    }
  }

  const body = [];
  for (const el of bodyShapes) {
    for (const line of shapeLines(el.shape)) body.push(`- ${line}`);
  }

  // Speaker notes
  const notesShape = slide.slideProperties?.notesPage?.pageElements?.find(
    (e) => e.shape?.placeholder?.type === "BODY"
  );
  const notes = notesShape ? shapeLines(notesShape.shape).join(" ") : "";

  const header = `## Slide ${index + 1}${title ? ` — ${title}` : ""}`;
  const out = [header, ""];
  if (body.length) out.push(...body, "");
  if (notes) out.push(`**Notes:** ${notes}`, "");
  return out.join("\n");
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

async function markSuccess(connectorId, itemCount, deckTitle) {
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
    [connectorId, itemCount, JSON.stringify({ resource_title: deckTitle })]
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
    if (row.type !== "slides")
      throw new Error(`wrong connector type: ${row.type}`);

    const presentationId = row.external_id;
    if (!presentationId) throw new Error("external_id missing");
    const tokenSecretArn = row.token_secret_arn;
    if (!tokenSecretArn) throw new Error("token_secret_arn missing");

    const tokenSecret = await getJson(tokenSecretArn);
    const refreshToken = tokenSecret.refresh_token;
    if (!refreshToken) throw new Error("refresh_token missing from secret");

    const accessToken = await refreshAccessToken(refreshToken);
    const deck = await fetchPresentation(accessToken, presentationId);
    const driveMeta = await fetchDriveMeta(accessToken, presentationId);
    const title = deck.title ?? presentationId;
    const deckSlug = slugify(title);
    const prefix = `${SOURCES_PREFIX}${deckSlug}/`;
    const key = `${prefix}content.md`;

    const slides = deck.slides ?? [];
    const rendered = slides.map((s, i) => renderSlide(s, i)).join("\n");

    const content = [
      `# ${title}`,
      "",
      `Source: [Google Slides](${row.external_url}) · ${slides.length} slide(s) · last synced ${new Date().toISOString()}`,
      "",
      rendered,
      "",
    ].join("\n");

    await putMarkdown(key, content);
    await putSidecar(key, {
      metadataAttributes: {
        source: "slides",
        connector_id: connectorId,
        presentation_id: presentationId,
        last_synced: new Date().toISOString(),
        source_modified_at: driveMeta.source_modified_at ?? null,
        source_author: driveMeta.source_author ?? null,
        source_url: driveMeta.source_url ?? row.external_url ?? null,
      },
    });

    await markSuccess(connectorId, slides.length, title);
    return { ok: true, title, slides: slides.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`slides sync ${connectorId} failed:`, err);
    await markError(connectorId, msg);
    throw err;
  }
};
