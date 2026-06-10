/**
 * Corpus loading — faithful port of generate.py's corpus section: listing,
 * the no-change hash, body loading, and the budgeted round-robin summary.
 *
 * Strings are sliced and measured by Unicode code point (via Array.from) to
 * match Python's str semantics, so the corpus-summary budget arithmetic and
 * the no-change hash line up with the Python generator.
 */

import { createHash } from "node:crypto";
import { GetObjectCommand, paginateListObjectsV2 } from "@aws-sdk/client-s3";
import { s3 } from "./awsClients.js";
import {
  CORPUS_PREFIX,
  CORPUS_PREVIEW_CHARS,
  CORPUS_SUMMARY_MAX_CHARS,
  DOCS_BUCKET,
  WIKI_MODE,
  WIKI_PREFIX,
} from "./config.js";

export interface SourceDoc {
  key: string;
  body: string;
}

/** (key, etag) pair, mirroring the Python tuples. */
export type Entry = [string, string];

const cps = (s: string) => Array.from(s);
const cpLen = (s: string) => cps(s).length;
const cpSlice = (s: string, n: number) => cps(s).slice(0, n).join("");

function stripQuotes(s: string): string {
  return s.replace(/^"+|"+$/g, "");
}

/** Lexicographic compare of (key, etag) tuples, matching Python's sorted(). */
export function tupleCmp(a: Entry, b: Entry): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  return 0;
}

const strCmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Decide whether to skip a key from the corpus. */
function isExcluded(key: string): boolean {
  // Always skip sidecars and "directory" keys.
  if (key.endsWith(".metadata.json") || key.endsWith("/")) return true;
  if (!key.endsWith(".md")) return true;

  // Code-mode: include only the configured corpus prefix.
  if (WIKI_MODE === "code") {
    if (!key.startsWith(CORPUS_PREFIX || "sources/github/")) return true;
    // Don't ingest our own output if a previous run wrote there.
    if (key.startsWith(WIKI_PREFIX)) return true;
    return false;
  }

  // Main mode: the team wiki is built from non-code sources only. Raw GitHub
  // repo files are represented by their isolated per-repo code wikis, and we
  // never feed our own wiki output back in.
  if (key.startsWith("sources/github/")) return true;
  if (key.startsWith("wiki/")) return true;
  return false;
}

/**
 * List (key, etag) pairs for every corpus doc, mode-aware. Cheap: just
 * paginates ListObjectsV2 (no GetObject). Sorted by key for deterministic
 * hashing.
 */
export async function listCorpusEntries(): Promise<Entry[]> {
  const entries: Entry[] = [];
  const listPrefix = WIKI_MODE === "code" ? CORPUS_PREFIX : "";
  const input: { Bucket: string; Prefix?: string } = { Bucket: DOCS_BUCKET };
  if (listPrefix) input.Prefix = listPrefix;

  for await (const page of paginateListObjectsV2({ client: s3 }, input)) {
    for (const obj of page.Contents ?? []) {
      const key = obj.Key!;
      if (isExcluded(key)) continue;
      entries.push([key, stripQuotes(obj.ETag ?? "")]);
    }
  }
  entries.sort((a, b) => strCmp(a[0], b[0]));
  return entries;
}

/**
 * SHA-256 over sorted (key, etag) pairs. Includes WIKI_MODE so a main-mode
 * hash can never collide with a code-mode hash on the same key set. Byte-for-
 * byte identical to the Python hash for the same inputs.
 */
export function computeCorpusSha(entries: Entry[]): string {
  const h = createHash("sha256");
  h.update(WIKI_MODE, "utf8");
  h.update(Buffer.from([0]));
  for (const [key, etag] of entries) {
    h.update(key, "utf8");
    h.update("\t", "utf8");
    h.update(etag, "utf8");
    h.update("\n", "utf8");
  }
  return h.digest("hex");
}

/** Read the existing wiki/_meta.json (or wiki/code/<repo>/_meta.json). */
export async function readPriorMeta(): Promise<Record<string, unknown>> {
  const key = `${WIKI_PREFIX}_meta.json`;
  try {
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: DOCS_BUCKET, Key: key })
    );
    const body = await obj.Body!.transformToString("utf-8");
    try {
      return JSON.parse(body);
    } catch (e) {
      console.error(`  [warn] prior ${key} unparseable: ${e}`);
      return {};
    }
  } catch (e: unknown) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) {
      return {};
    }
    console.error(`  [warn] couldn't read prior ${key}: ${e}`);
    return {};
  }
}

/**
 * Read the existing wiki/_index.json. Returns null on first run / missing
 * object. Used by the incremental path to recover the page→source graph.
 */
export async function readPriorIndex(): Promise<{
  title?: string;
  description?: string;
  pages?: unknown[];
} | null> {
  const key = `${WIKI_PREFIX}_index.json`;
  try {
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: DOCS_BUCKET, Key: key })
    );
    return JSON.parse(await obj.Body!.transformToString("utf-8"));
  } catch (e: unknown) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) {
      return null;
    }
    console.error(`  [warn] couldn't read prior ${key}: ${e}`);
    return null;
  }
}

/** Body-load pass — only run after the no-change guard decides to regen. */
export async function loadSourceDocs(keys: string[]): Promise<SourceDoc[]> {
  const docs: SourceDoc[] = [];
  for (const key of keys) {
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: DOCS_BUCKET, Key: key })
    );
    // transformToString decodes UTF-8 with U+FFFD replacement, matching the
    // Python decode(errors="replace").
    const body = await obj.Body!.transformToString("utf-8");
    docs.push({ key, body });
  }
  return docs;
}

/** Group a corpus key into a "source area" for representative sampling. */
function sourceArea(key: string): string {
  const parts = key.split("/");
  if (parts[0] === "sources" && parts.length >= 3) {
    return parts.slice(0, 3).join("/");
  }
  if (parts.length >= 2) return parts[0] + "/";
  return "(root)";
}

/**
 * Render the structure-pass corpus summary, budgeted and representative.
 * Groups docs by source area and fills round-robin so every area contributes
 * its first doc before any area contributes its second, until
 * CORPUS_SUMMARY_MAX_CHARS is reached.
 *
 * Returns [summaryXml, includedDocCount].
 */
export function buildCorpusSummary(docs: SourceDoc[]): [string, number] {
  const groups = new Map<string, SourceDoc[]>();
  for (const d of docs) {
    const area = sourceArea(d.key);
    const g = groups.get(area);
    if (g) g.push(d);
    else groups.set(area, [d]);
  }
  for (const g of groups.values()) g.sort((a, b) => strCmp(a.key, b.key));
  const orderedGroups = [...groups.keys()].sort(strCmp).map((k) => groups.get(k)!);

  const parts: string[] = [];
  let used = 0;
  let included = 0;
  let idx = 0;
  for (;;) {
    let progressed = false;
    for (const g of orderedGroups) {
      if (idx >= g.length) continue;
      progressed = true;
      const d = g[idx];
      const preview = cpSlice(d.body.trim(), CORPUS_PREVIEW_CHARS);
      const block = `<doc path="${d.key}">\n${preview}\n</doc>`;
      // Always include at least one doc; otherwise honor the budget.
      if (included > 0 && used + cpLen(block) > CORPUS_SUMMARY_MAX_CHARS) {
        return [parts.join("\n\n"), included];
      }
      parts.push(block);
      used += cpLen(block) + 2;
      included += 1;
    }
    if (!progressed) break;
    idx += 1;
  }
  return [parts.join("\n\n"), included];
}

/**
 * Build a reference catalog of the per-repo code wikis for the team wiki, and
 * return each code wiki's _meta.json (key, etag) so a repo change flows into
 * the team wiki's no-change hash. Empty catalog when no code wikis exist.
 */
export async function loadCodeWikiCatalog(): Promise<[string, Entry[]]> {
  const indexKeys: string[] = [];
  const metaEntries: Entry[] = [];

  for await (const page of paginateListObjectsV2(
    { client: s3 },
    { Bucket: DOCS_BUCKET, Prefix: "wiki/code/" }
  )) {
    for (const obj of page.Contents ?? []) {
      const key = obj.Key!;
      if (key.endsWith("/_index.json")) indexKeys.push(key);
      else if (key.endsWith("/_meta.json")) {
        metaEntries.push([key, stripQuotes(obj.ETag ?? "")]);
      }
    }
  }
  metaEntries.sort(tupleCmp);

  const blocks: string[] = [];
  for (const ik of [...indexKeys].sort(strCmp)) {
    let idx: {
      title?: string;
      description?: string;
      pages?: { slug?: string; title?: string; description?: string }[];
    };
    try {
      const obj = await s3.send(
        new GetObjectCommand({ Bucket: DOCS_BUCKET, Key: ik })
      );
      idx = JSON.parse(await obj.Body!.transformToString("utf-8"));
    } catch (e) {
      console.error(`  [warn] couldn't read code wiki index ${ik}: ${e}`);
      continue;
    }
    const repoPrefix = ik.slice(0, ik.length - "_index.json".length);
    const lines = [`Repo wiki: ${idx.title || repoPrefix}`];
    const desc = (idx.description || "").trim();
    if (desc) lines.push(`  ${desc}`);
    for (const p of idx.pages ?? []) {
      const slug = p.slug;
      if (!slug) continue;
      const path = `${repoPrefix}${slug}.md`;
      const pdesc = (p.description || "").trim();
      lines.push(
        `  - ${p.title || "Untitled"} → ${path}` +
          (pdesc ? ` — ${pdesc}` : "")
      );
    }
    blocks.push(lines.join("\n"));
  }
  return [blocks.join("\n\n"), metaEntries];
}
