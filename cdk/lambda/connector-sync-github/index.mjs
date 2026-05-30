/**
 * connector-sync-github Lambda
 *
 * Input: { connectorId: string }
 *
 * Pulls a GitHub repo via the REST API (no clone), filters files by
 * extension + size, wraps code in fenced markdown blocks, and writes
 * them under sources/github/<owner>/<repo>/<path>.md.
 *
 * Auth: a GitHub Personal Access Token stored in the per-connector
 * secret as { github_pat: "ghp_…" }. PAT scope needed: `repo` (private
 * repos) or `public_repo` (public only).
 *
 * Defaults are deliberately conservative — we want signal, not the
 * full filesystem. Override include/exclude patterns by editing
 * INCLUDE_RE / EXCLUDE_PATH_PARTS / MAX_FILE_BYTES below.
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
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

// pg-http ships as a Lambda layer (zero-dependency Neon-over-HTTP helper).
// Connectors live in the Postgres `connectors` table; see lib/db/schema.ts.
const require = createRequire(import.meta.url);
const { pgFetchOne, pgExecute } = require("pg-http");

const s3 = new S3Client({});
const sm = new SecretsManagerClient({});
const lambdaClient = new LambdaClient({});

const DATABASE_URL = process.env.DATABASE_URL;
// The brain's docs bucket comes from the invocation event; env-var
// fallback keeps legacy invokes against the default brain working.
let DOCS_BUCKET = process.env.DOCS_BUCKET;

const SOURCES_PREFIX = "sources/github/";

// File-extension allowlist. Anything not matching this regex is skipped.
// Tuned for "things humans wrote that explain something" — config files
// like package.json + lockfiles produce noise without context, so they're
// excluded even though they technically match here.
const INCLUDE_RE =
  /\.(md|mdx|txt|ts|tsx|js|jsx|mjs|cjs|py|go|rs|sql|ya?ml|json|toml|sh|rb|java|kt|swift|c|cpp|h|hpp|cs|php|scala|hcl|tf|gradle|dockerfile)$/i;

// Path segments that are *always* skipped, regardless of extension.
const EXCLUDE_PATH_PARTS = [
  "node_modules/",
  "dist/",
  "build/",
  ".next/",
  ".git/",
  ".turbo/",
  ".cache/",
  "coverage/",
  "vendor/",
  "target/",
  "__pycache__/",
  ".pytest_cache/",
  ".venv/",
  "venv/",
  "out/",
  ".vscode/",
  ".idea/",
];

// Filenames (basename match) to skip — usually generated or low-signal.
const EXCLUDE_BASENAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "Cargo.lock",
  "Pipfile.lock",
  "poetry.lock",
  "composer.lock",
  "go.sum",
  ".DS_Store",
]);

// Skip files larger than this (bytes). 200KB ≈ ~3000 lines of code; bigger
// files are usually generated, vendored, or fixture data.
const MAX_FILE_BYTES = 200 * 1024;

// ── Helpers ──────────────────────────────────────────────────────────

function slugify(s) {
  return (
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "item"
  );
}

async function getJson(secretId) {
  const r = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
  return JSON.parse(r.SecretString ?? "{}");
}

function languageFromPath(path) {
  const m = path.match(/\.([^./]+)$/);
  if (!m) return "";
  const ext = m[1].toLowerCase();
  const map = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    go: "go",
    rs: "rust",
    sql: "sql",
    yaml: "yaml",
    yml: "yaml",
    json: "json",
    toml: "toml",
    sh: "bash",
    rb: "ruby",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    scala: "scala",
    hcl: "hcl",
    tf: "hcl",
    gradle: "groovy",
    md: "markdown",
    mdx: "markdown",
    txt: "",
  };
  return map[ext] ?? ext;
}

function shouldInclude(path, size) {
  if (size != null && size > MAX_FILE_BYTES) return false;
  const lower = path.toLowerCase();
  for (const seg of EXCLUDE_PATH_PARTS) {
    if (lower.includes(seg)) return false;
  }
  const base = path.split("/").pop();
  if (EXCLUDE_BASENAMES.has(base)) return false;
  // Special-case: keep Dockerfile / Makefile etc with no extension
  if (/^(dockerfile|makefile|jenkinsfile|procfile)$/i.test(base)) return true;
  return INCLUDE_RE.test(path);
}

// ── GitHub API ───────────────────────────────────────────────────────

async function gh(token, path) {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "context101-connector",
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    const e = new Error(`github ${path} ${r.status}: ${body.slice(0, 400)}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

async function getRepoMeta(token, owner, repo) {
  return gh(token, `/repos/${owner}/${repo}`);
}

async function getTree(token, owner, repo, ref) {
  // recursive=1 returns the full tree in one shot. If `truncated: true` on
  // the response, the repo is huge (>100k files / >7MB) and we miss some.
  // For v1, we surface a warning in the row but proceed with what we got.
  //
  // The `sha` on the response is the tree object's SHA — deterministic
  // from the file structure + blob contents. Two syncs with the same
  // tree SHA are definitionally identical, so we use it to skip the
  // expensive code-wiki Opus regen when nothing changed.
  const j = await gh(
    token,
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`
  );
  return {
    entries: j.tree ?? [],
    truncated: !!j.truncated,
    treeSha: j.sha ?? null,
  };
}

async function getBlobText(token, owner, repo, sha) {
  const j = await gh(
    token,
    `/repos/${owner}/${repo}/git/blobs/${encodeURIComponent(sha)}`
  );
  if (j.encoding !== "base64") {
    throw new Error(`unexpected blob encoding: ${j.encoding}`);
  }
  return Buffer.from(j.content, "base64").toString("utf8");
}

async function getAuthenticatedUser(token) {
  try {
    return await gh(token, "/user");
  } catch (e) {
    console.warn("github /user failed:", e.message);
    return null;
  }
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

// ── Status updates ───────────────────────────────────────────────────

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

async function markSuccess(connectorId, itemCount, repoFullName) {
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
    [connectorId, itemCount, JSON.stringify({ resource_title: repoFullName })]
  );
}

// Merge arbitrary keys into the connector's metadata jsonb (github stores
// github_account_login and last_synced_tree_sha there).
async function mergeMetadata(connectorId, patch) {
  await pgExecute(
    DATABASE_URL,
    `update connectors
       set metadata = metadata || $2::jsonb, updated_at = now()
     where id = $1`,
    [connectorId, JSON.stringify(patch)]
  );
}

// ── File rendering ───────────────────────────────────────────────────

function renderMarkdown(text, ctx) {
  // Pass markdown through as-is, but prepend a small frontmatter line so
  // the wiki generator and citations can see where it came from.
  return [
    `# ${ctx.path}`,
    "",
    `Source: [GitHub](${ctx.htmlUrl}) · repo \`${ctx.repoFullName}\` · last synced ${ctx.now}`,
    "",
    text,
    "",
  ].join("\n");
}

function renderCode(text, ctx) {
  const fence = ctx.language || "";
  return [
    `# ${ctx.path}`,
    "",
    `Source: [GitHub](${ctx.htmlUrl}) · repo \`${ctx.repoFullName}\` · ${ctx.language || "text"} · last synced ${ctx.now}`,
    "",
    `\`\`\`${fence}`,
    text,
    "```",
    "",
  ].join("\n");
}

// Concurrency-limited map. Lambda has a single CPU but network I/O
// benefits from parallelism. 8 is conservative enough to stay well
// under GitHub's 5000 req/h authenticated rate limit.
async function pmap(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    new Array(Math.min(limit, items.length)).fill(0).map(async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    })
  );
  return out;
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
      `select id, type, external_id, external_url, token_secret_arn,
              metadata, brain_id
         from connectors where id = $1`,
      [connectorId]
    );
    if (!row) throw new Error(`connector ${connectorId} not found`);
    if (row.type !== "github")
      throw new Error(`wrong connector type: ${row.type}`);

    // metadata arrives as a JSON string (raw text output); github stores
    // last_synced_tree_sha + github_account_login there.
    const metadata =
      typeof row.metadata === "string" && row.metadata
        ? JSON.parse(row.metadata)
        : row.metadata || {};

    // external_id is "<owner>/<repo>" (parsed at create time)
    const [owner, repo] = (row.external_id || "").split("/");
    if (!owner || !repo) throw new Error(`bad external_id: ${row.external_id}`);

    const tokenSecretArn = row.token_secret_arn;
    if (!tokenSecretArn) throw new Error("token_secret_arn missing");
    const tokenSecret = await getJson(tokenSecretArn);
    const pat = tokenSecret.github_pat;
    if (!pat) throw new Error("github_pat missing from secret");

    const meta = await getRepoMeta(pat, owner, repo);
    const branch = meta.default_branch || "main";
    const repoFullName = meta.full_name; // "owner/repo"
    const repoHtmlUrl = meta.html_url;

    const { entries, truncated, treeSha } = await getTree(
      pat,
      owner,
      repo,
      branch
    );

    // Cost guard: skip the code-wiki Fargate dispatch when the tree
    // hasn't moved since last sync. We still re-PUT the source files
    // (idempotent, microseconds, restores anything deleted out of band)
    // — only the expensive Opus regen is gated.
    const lastTreeSha = metadata.last_synced_tree_sha ?? null;
    const treeChanged = !lastTreeSha || lastTreeSha !== treeSha;

    // Filter to "blob" entries (files), apply include/exclude.
    const files = entries
      .filter((e) => e.type === "blob")
      .filter((e) => shouldInclude(e.path, e.size));

    if (files.length === 0) {
      await markSuccess(connectorId, 0, repoFullName);
      return { ok: true, repo: repoFullName, files: 0, note: "no matching files" };
    }

    // Single-level slug under sources/github/ keeps the layout symmetric
    // with the other connectors and matches the delete route's slug logic
    // (which derives the prefix from row.resource_title).
    const repoSlug = slugify(`${owner}-${repo}`);
    const prefix = `${SOURCES_PREFIX}${repoSlug}/`;
    const now = new Date().toISOString();
    const freshKeys = new Set();

    // Fetch + write with bounded concurrency
    let written = 0;
    await pmap(files, 8, async (f) => {
      try {
        const text = await getBlobText(pat, owner, repo, f.sha);
        // Skip likely-binary files that slipped past the extension filter
        if (/\x00/.test(text)) return;

        const language = languageFromPath(f.path);
        const isMarkdown = /^markdown$/i.test(language);
        const htmlUrl = `${repoHtmlUrl}/blob/${branch}/${f.path}`;
        const ctx = {
          path: f.path,
          repoFullName,
          htmlUrl,
          language,
          now,
        };
        const content = isMarkdown
          ? renderMarkdown(text, ctx)
          : renderCode(text, ctx);

        const key = `${prefix}${f.path}.md`;
        await putMarkdown(key, content);
        await putSidecar(key, {
          metadataAttributes: {
            source: "github",
            connector_id: connectorId,
            repo: repoFullName,
            path: f.path,
            language,
            commit_sha: f.sha,
            branch,
            last_synced: now,
          },
        });
        freshKeys.add(key);
        freshKeys.add(`${key}.metadata.json`);
        written += 1;
      } catch (e) {
        console.warn(`skip ${f.path}: ${e.message}`);
      }
    });

    // Prune stale keys (files removed/renamed since last sync)
    const existing = await listKeysUnder(prefix);
    const stale = existing.filter((k) => !freshKeys.has(k));
    await deleteKeys(stale);

    // Identify the connecting GitHub user (informational, shown on card)
    const me = await getAuthenticatedUser(pat);
    if (me?.login) {
      await mergeMetadata(connectorId, { github_account_login: me.login });
    }

    await markSuccess(connectorId, written, repoFullName);

    // Persist the tree SHA so the next sync can compare. Done after
    // markSuccess so the row only carries an SHA we actually finished
    // processing — a crash mid-write doesn't poison the next run.
    if (treeSha) {
      await mergeMetadata(connectorId, { last_synced_tree_sha: treeSha });
    }

    // Layer 2: optionally kick off the per-repo code-wiki Fargate task.
    //
    // OFF by default — wiki regens cost ~$0.30-0.80 in Opus per run
    // and we'd rather pay only when a human asks. Set the Lambda env
    // var AUTO_TRIGGER_CODE_WIKI=true to opt back into the original
    // behavior (auto-regen after every successful github sync, gated
    // by tree SHA change).
    //
    // Manual paths still work: invoking start-wiki-gen directly
    // (`{ mode: "code", repo: "owner/repo" }`) or hitting the wiki UI
    // refresh button regenerates regardless of this flag.
    const autoTrigger =
      (process.env.AUTO_TRIGGER_CODE_WIKI ?? "").toLowerCase() === "true";
    const startWikiGenFn = process.env.START_WIKI_GEN_FN_NAME;
    let codeWikiFired = false;
    if (autoTrigger && startWikiGenFn && written > 0 && treeChanged) {
      await lambdaClient
        .send(
          new InvokeCommand({
            FunctionName: startWikiGenFn,
            InvocationType: "Event",
            Payload: new TextEncoder().encode(
              JSON.stringify({
                mode: "code",
                repo: repoFullName,
                // Carry the brain id so the wiki generator writes back to
                // the same brain's docs bucket. `event.brainId` is set by
                // the dispatcher; the row also stores brain_id so we fall
                // back to it if invoked directly.
                brain_id: event.brainId ?? row.brain_id ?? "default",
              })
            ),
          })
        )
        .then(() => {
          codeWikiFired = true;
        })
        .catch((e) => console.error("code-wiki dispatch failed:", e));
    } else if (autoTrigger && !treeChanged) {
      console.log(
        `tree SHA unchanged (${treeSha}) — skipping code-wiki regen for ${repoFullName}`
      );
    } else if (!autoTrigger) {
      console.log(
        "AUTO_TRIGGER_CODE_WIKI not set — skipping code-wiki dispatch (manual only)"
      );
    }

    return {
      ok: true,
      repo: repoFullName,
      branch,
      files_written: written,
      files_pruned: stale.length,
      tree_truncated: truncated,
      tree_sha: treeSha,
      tree_changed: treeChanged,
      code_wiki_fired: codeWikiFired,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`github sync ${connectorId} failed:`, err);
    await markError(connectorId, msg);
    throw err;
  }
};
