/**
 * S3 writes — port of generate.py's output section: per-page markdown +
 * sidecars, _index.json, _meta.json, and stale-page pruning. JSON is written
 * with pyDumps so the structural files stay byte-comparable with Python.
 */

import {
  DeleteObjectsCommand,
  PutObjectCommand,
  paginateListObjectsV2,
} from "@aws-sdk/client-s3";
import { s3 } from "./awsClients.js";
import { DOCS_BUCKET, MODEL_ID, REPO_FULL_NAME, WIKI_MODE, WIKI_PREFIX } from "./config.js";
import { pyDumps } from "./pyjson.js";
import type { IndexPage } from "./incremental.js";
import type { PageSpec } from "./structure.js";

export async function putObject(
  key: string,
  body: string,
  contentType: string
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: DOCS_BUCKET,
      Key: key,
      Body: Buffer.from(body, "utf-8"),
      ContentType: contentType,
    })
  );
}

async function listKeysUnder(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  for await (const page of paginateListObjectsV2(
    { client: s3 },
    { Bucket: DOCS_BUCKET, Prefix: prefix }
  )) {
    for (const obj of page.Contents ?? []) keys.push(obj.Key!);
  }
  return keys;
}

async function deleteKeys(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000).map((k) => ({ Key: k }));
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: DOCS_BUCKET,
        Delete: { Objects: batch, Quiet: true },
      })
    );
  }
}

// Keep the sidecar tiny: Bedrock S3 Vectors ignores a metadata sidecar
// entirely if it exceeds 1024 bytes, which would silently strip `source` and
// make the page invisible to search_knowledge's source=wiki filter.
function buildWikiSidecar(slug: string, startedAt: string): object {
  const sourceTag = WIKI_MODE === "code" ? "code-wiki" : "wiki";
  const attrs: Record<string, string> = {
    source: sourceTag,
    generated_at: startedAt,
    page_slug: slug,
  };
  if (WIKI_MODE === "code" && REPO_FULL_NAME) attrs.repo = REPO_FULL_NAME;
  return { metadataAttributes: attrs };
}

export interface WikiMetaExtra {
  // Persisted to _meta.json only when WIKI_GAPS=1. Omitted otherwise so the
  // meta shape matches the Python generator.
  gaps?: string[];
  // Per-file {key: etag} manifest, written only when WIKI_INCREMENTAL=1 so the
  // next run can diff at the file level. Omitted otherwise (parity preserved).
  sourceManifest?: Record<string, string>;
}

export async function writeWikiOutputs(
  title: string,
  description: string,
  specs: PageSpec[],
  pageBodies: Record<string, string>,
  sourceDocCount: number,
  startedAt: string,
  corpusSha: string,
  extra: WikiMetaExtra = {}
): Promise<void> {
  // Track every key this run writes so we can prune stale pages below.
  const fresh = new Set<string>();

  // Pages + sidecars. Write the sidecar first so the next auto-ingest run sees
  // both files together and attaches metadata on first pass.
  for (const spec of specs) {
    const body = pageBodies[spec.id];
    const mdKey = `${WIKI_PREFIX}${spec.slug}.md`;
    const sidecar = buildWikiSidecar(spec.slug, startedAt);
    await putObject(`${mdKey}.metadata.json`, pyDumps(sidecar), "application/json");
    await putObject(mdKey, body, "text/markdown; charset=utf-8");
    fresh.add(mdKey);
    fresh.add(`${mdKey}.metadata.json`);
  }

  // Nav index — maps page id → slug/title, preserves order + related links.
  const index = {
    title,
    description,
    pages: specs.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      slug: s.slug,
      importance: s.importance,
      sources: s.relevant_files,
      related: s.related_pages,
    })),
  };
  await putObject(`${WIKI_PREFIX}_index.json`, pyDumps(index, 2), "application/json");
  fresh.add(`${WIKI_PREFIX}_index.json`);

  // Metadata — drives the "Last indexed" badge; corpus_sha is the no-change
  // fingerprint the next run reads back to short-circuit.
  const meta: Record<string, unknown> = {
    generated_at: startedAt,
    finished_at: new Date().toISOString(),
    source_doc_count: sourceDocCount,
    page_count: specs.length,
    model_id: MODEL_ID,
    corpus_sha: corpusSha,
  };
  if (extra.gaps && extra.gaps.length) meta.gaps = extra.gaps;
  if (extra.sourceManifest) meta.source_manifest = extra.sourceManifest;
  await putObject(`${WIKI_PREFIX}_meta.json`, pyDumps(meta, 2), "application/json");
  fresh.add(`${WIKI_PREFIX}_meta.json`);

  // Prune stale pages from prior runs. The model picks different page titles
  // each run, so slugs drift; without pruning, old pages pile up in the vector
  // index. Delete any object under WIKI_PREFIX this run didn't just write. In
  // main mode, never touch the nested code wikis under wiki/code/.
  const existing = await listKeysUnder(WIKI_PREFIX);
  const stale = existing.filter(
    (k) =>
      !fresh.has(k) &&
      !(WIKI_MODE !== "code" && k.startsWith(`${WIKI_PREFIX}code/`))
  );
  if (stale.length) {
    await deleteKeys(stale);
    console.log(`  pruned ${stale.length} stale wiki object(s) from prior runs`);
  }
}

export interface IncrementalWriteArgs {
  title: string;
  description: string;
  /** Full merged page set for the new _index.json. */
  pages: IndexPage[];
  /** id → markdown body, for the subset of pages regenerated this run. */
  regenerated: Record<string, string>;
  /** Slugs of pages removed this run. */
  deletedSlugs: string[];
  sourceDocCount: number;
  startedAt: string;
  corpusSha: string;
  sourceManifest: Record<string, string>;
}

/**
 * Write only the deltas of an incremental run: the regenerated pages + their
 * sidecars, deletions for removed pages, and a fresh _index.json / _meta.json.
 * Unchanged pages are left untouched in S3 — no global prune (unlike the full
 * rebuild path), so untouched pages keep their identity and aren't re-uploaded.
 */
export async function writeIncrementalOutputs(
  args: IncrementalWriteArgs
): Promise<void> {
  const {
    title,
    description,
    pages,
    regenerated,
    deletedSlugs,
    sourceDocCount,
    startedAt,
    corpusSha,
    sourceManifest,
  } = args;

  // Regenerated pages + sidecars (sidecar first, mirroring the full path).
  for (const p of pages) {
    if (!(p.id in regenerated)) continue;
    const mdKey = `${WIKI_PREFIX}${p.slug}.md`;
    await putObject(
      `${mdKey}.metadata.json`,
      pyDumps(buildWikiSidecar(p.slug, startedAt)),
      "application/json"
    );
    await putObject(mdKey, regenerated[p.id], "text/markdown; charset=utf-8");
  }

  // Delete removed pages (page + sidecar).
  const delKeys: string[] = [];
  for (const slug of deletedSlugs) {
    delKeys.push(`${WIKI_PREFIX}${slug}.md`, `${WIKI_PREFIX}${slug}.md.metadata.json`);
  }
  if (delKeys.length) {
    await deleteKeys(delKeys);
    console.log(`  deleted ${deletedSlugs.length} page(s) whose sources were removed`);
  }

  // Rewrite the nav index with the full merged page set.
  const index = {
    title,
    description,
    pages: pages.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      slug: p.slug,
      importance: p.importance,
      sources: p.sources,
      related: p.related,
    })),
  };
  await putObject(`${WIKI_PREFIX}_index.json`, pyDumps(index, 2), "application/json");

  const meta = {
    generated_at: startedAt,
    finished_at: new Date().toISOString(),
    source_doc_count: sourceDocCount,
    page_count: pages.length,
    model_id: MODEL_ID,
    corpus_sha: corpusSha,
    source_manifest: sourceManifest,
  };
  await putObject(`${WIKI_PREFIX}_meta.json`, pyDumps(meta, 2), "application/json");
}
