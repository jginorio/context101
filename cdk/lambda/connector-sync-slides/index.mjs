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
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  S3Client,
  PutObjectCommand,
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

async function markSuccess(connectorId, itemCount, deckTitle) {
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
        ":rt": deckTitle,
      },
    })
  );
}

// ── Handler ──────────────────────────────────────────────────────────

export const handler = async (event) => {
  const connectorId = event?.connectorId;
  if (!connectorId) throw new Error("connectorId is required");
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
    if (row.type !== "slides")
      throw new Error(`wrong connector type: ${row.type}`);

    const presentationId = row.resource_id;
    if (!presentationId) throw new Error("resource_id missing");
    const tokenSecretArn = row.token_secret_arn;
    if (!tokenSecretArn) throw new Error("token_secret_arn missing");

    const tokenSecret = await getJson(tokenSecretArn);
    const refreshToken = tokenSecret.refresh_token;
    if (!refreshToken) throw new Error("refresh_token missing from secret");

    const accessToken = await refreshAccessToken(refreshToken);
    const deck = await fetchPresentation(accessToken, presentationId);
    const title = deck.title ?? presentationId;
    const deckSlug = slugify(title);
    const prefix = `${SOURCES_PREFIX}${deckSlug}/`;
    const key = `${prefix}content.md`;

    const slides = deck.slides ?? [];
    const rendered = slides.map((s, i) => renderSlide(s, i)).join("\n");

    const content = [
      `# ${title}`,
      "",
      `Source: [Google Slides](${row.resource_url}) · ${slides.length} slide(s) · last synced ${new Date().toISOString()}`,
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
