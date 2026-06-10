/**
 * Context101 Wiki Generator (TypeScript port).
 *
 * Default flow (identical to wiki-generator/generate.py): list corpus →
 * no-change guard → corpus summary → structure pass → per-page generation →
 * write pages/sidecars/index/meta + prune.
 *
 * Flag-gated extensions, all OFF by default (parity preserved when off):
 *   • WIKI_AUTOLINK    — deterministic related_pages from shared sources.
 *   • WIKI_GAPS        — emit + persist a <gaps> list.
 *   • WIKI_INCREMENTAL — regenerate only the pages a corpus change touches,
 *                        route newly added sources, delete orphaned pages.
 *                        WIKI_FORCE (the manual button) does a full re-plan so
 *                        the structure never ossifies. See README.md.
 */

import { deterministicRelated, relatedFromSources } from "./autolink.js";
import {
  CORPUS_PREFIX,
  CORPUS_PREVIEW_CHARS,
  CORPUS_SUMMARY_MAX_CHARS,
  DOCS_BUCKET,
  MAX_PAGES,
  MIN_PAGES,
  MODEL_ID,
  MODEL_PROVIDER,
  REPO_FULL_NAME,
  WIKI_AUTOLINK,
  WIKI_FORCE,
  WIKI_GAPS,
  WIKI_INCREMENTAL,
  WIKI_MODE,
  WIKI_PREFIX,
} from "./config.js";
import {
  buildCorpusSummary,
  computeCorpusSha,
  type Entry,
  listCorpusEntries,
  loadCodeWikiCatalog,
  loadSourceDocs,
  readPriorIndex,
  readPriorMeta,
  type SourceDoc,
  tupleCmp,
} from "./corpus.js";
import {
  buildManifest,
  diffManifest,
  type IndexPage,
  indexPageToSpec,
  planIncremental,
} from "./incremental.js";
import { invokeLlm } from "./llm.js";
import { writeIncrementalOutputs, writeWikiOutputs } from "./outputs.js";
import {
  CODE_PAGE_PROMPT,
  CODE_STRUCTURE_PROMPT,
  fmt,
  GAPS_ADDENDUM,
  PAGE_PROMPT,
  ROUTE_PROMPT,
  STRUCTURE_PROMPT,
} from "./prompts.js";
import {
  extractRouting,
  extractXml,
  parseGaps,
  parseRouting,
  parseStructure,
  type PageSpec,
  type RoutingPlan,
} from "./structure.js";

async function generatePage(
  spec: PageSpec,
  docsByKey: Map<string, SourceDoc>,
  codeWikiCatalog = ""
): Promise<string> {
  if (spec.relevant_files.length === 0) {
    throw new Error(`Page ${spec.id} (${spec.title}) has no relevant_files`);
  }
  const sourceBlocks = spec.relevant_files.map((key) => {
    const doc = docsByKey.get(key)!;
    return `<file path="${doc.key}">\n${doc.body}\n</file>`;
  });
  const sourceContent = sourceBlocks.join("\n\n");

  const template = WIKI_MODE === "code" ? CODE_PAGE_PROMPT : PAGE_PROMPT;
  const prompt = fmt(template, {
    page_title: spec.title,
    page_description: spec.description,
    source_content: sourceContent,
    code_wikis: codeWikiCatalog || "(none)",
    repo_full_name: REPO_FULL_NAME || "this repository",
  });
  return invokeLlm(prompt);
}

export async function main(): Promise<number> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  // Identify ourselves first. The Python generator prints no banner, so this
  // line doubles as the "which generator ran this task?" discriminator in
  // CloudWatch (no banner = Python).
  const flag = (v: boolean) => (v ? "on" : "off");
  console.log(
    `Context101 Wiki Generator (TypeScript) · mode=${WIKI_MODE} ` +
      `provider=${MODEL_PROVIDER} model=${MODEL_ID}`
  );
  console.log(
    `  flags: autolink=${flag(WIKI_AUTOLINK)} gaps=${flag(WIKI_GAPS)} ` +
      `incremental=${flag(WIKI_INCREMENTAL)} force=${flag(WIKI_FORCE)} ` +
      `· bucket=${DOCS_BUCKET}`
  );

  const scope =
    WIKI_MODE === "code"
      ? `prefix=${CORPUS_PREFIX}`
      : `whole bucket (skipping top-level ${WIKI_PREFIX})`;
  console.log(`Listing source docs from s3://${DOCS_BUCKET}/  · ${scope}`);

  const entries = await listCorpusEntries();
  if (entries.length === 0) {
    console.error("No source markdown found — nothing to generate.");
    return 1;
  }
  console.log(`  ${entries.length} source doc(s)`);

  // Per-repo code wikis are referenced, not ingested. Load their catalog (for
  // prompts) and fold each code wiki's _meta.json (key, etag) into the full
  // path's no-change hash so a repo change triggers a refresh of references.
  let codeWikiCatalog = "";
  let codeMetaEntries: Entry[] = [];
  if (WIKI_MODE !== "code") {
    [codeWikiCatalog, codeMetaEntries] = await loadCodeWikiCatalog();
    if (codeMetaEntries.length) {
      console.log(`  ${codeMetaEntries.length} code wiki(s) available to reference`);
    }
  }

  // Incremental path: only attempt when enabled and not forced. WIKI_FORCE (the
  // manual "Refresh now" button) always does a full re-plan (Tier 3).
  if (WIKI_INCREMENTAL && !WIKI_FORCE) {
    const handled = await tryIncremental(entries, codeWikiCatalog, startedAt, t0);
    if (handled !== null) return handled;
    console.log(
      "Incremental unavailable (first run or missing prior wiki) — full re-plan."
    );
  } else if (WIKI_INCREMENTAL && WIKI_FORCE) {
    console.log("WIKI_FORCE=1 — full re-plan (Tier 3), refreshing the whole structure.");
  }

  return runFull(entries, codeWikiCatalog, codeMetaEntries, startedAt, t0);
}

// ── Full rebuild (the verified-parity path) ───────────────────────────────

async function runFull(
  entries: Entry[],
  codeWikiCatalog: string,
  codeMetaEntries: Entry[],
  startedAt: string,
  t0: number
): Promise<number> {
  const corpusSha = computeCorpusSha([...entries, ...codeMetaEntries].sort(tupleCmp));
  const priorMeta = await readPriorMeta();
  const priorSha = priorMeta.corpus_sha as string | undefined;
  if (priorSha === corpusSha && !WIKI_FORCE) {
    console.log(
      `Corpus unchanged since last regen (${priorMeta.finished_at ?? "?"}). ` +
        `Skipping (set WIKI_FORCE=1 to override). sha=${corpusSha.slice(0, 12)}…`
    );
    return 0;
  }
  if (WIKI_FORCE && priorSha === corpusSha) {
    console.log("WIKI_FORCE=1 — regenerating despite unchanged corpus.");
  }

  const docs = await loadSourceDocs(entries.map(([k]) => k));
  const docsByKey = new Map(docs.map((d) => [d.key, d]));
  const [corpusSummary, summaryDocs] = buildCorpusSummary(docs);
  if (summaryDocs < docs.length) {
    console.log(
      `  structure corpus: ${summaryDocs}/${docs.length} docs ` +
        `(round-robin across source areas, capped at ${CORPUS_SUMMARY_MAX_CHARS} chars)`
    );
  }

  console.log(`Requesting wiki structure from Opus (mode=${WIKI_MODE})…`);
  const structureTemplate =
    WIKI_MODE === "code" ? CODE_STRUCTURE_PROMPT : STRUCTURE_PROMPT;
  let structurePrompt = fmt(structureTemplate, {
    corpus_summary: corpusSummary,
    code_wikis: codeWikiCatalog || "(none)",
    min_pages: MIN_PAGES,
    max_pages: MAX_PAGES,
    repo_full_name: REPO_FULL_NAME || "this repository",
  });
  if (WIKI_GAPS) structurePrompt += GAPS_ADDENDUM;

  const structureRaw = await invokeLlm(structurePrompt);
  const structureXml = extractXml(structureRaw);
  const { title, description, specs } = parseStructure(
    structureXml,
    new Set(docsByKey.keys())
  );
  console.log(`  plan: ${specs.length} page(s)`);
  for (const s of specs) {
    console.log(`    - ${s.id}  ${s.title}  (${s.relevant_files.length} source(s))`);
  }

  let gaps: string[] = [];
  if (WIKI_GAPS) {
    gaps = parseGaps(structureXml);
    if (gaps.length) console.log(`  gaps flagged: ${gaps.length}`);
  }
  // Incremental needs deterministic related_pages to maintain links across
  // partial updates, so a full re-plan in incremental mode computes them too.
  if (WIKI_AUTOLINK || WIKI_INCREMENTAL) {
    const rel = deterministicRelated(specs);
    for (const s of specs) s.related_pages = rel.get(s.id) ?? [];
    console.log("  related_pages computed deterministically from shared sources");
  }

  const pageBodies: Record<string, string> = {};
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    console.log(`Generating ${i + 1}/${specs.length}: ${spec.title}`);
    pageBodies[spec.id] = await generatePage(spec, docsByKey, codeWikiCatalog);
  }

  console.log(
    `Writing ${specs.length} page(s) + _index.json + _meta.json to ` +
      `s3://${DOCS_BUCKET}/${WIKI_PREFIX}`
  );
  await writeWikiOutputs(
    title,
    description,
    specs,
    pageBodies,
    docs.length,
    startedAt,
    corpusSha,
    {
      gaps,
      // Persist the manifest so the next run can go incremental.
      ...(WIKI_INCREMENTAL ? { sourceManifest: buildManifest(entries) } : {}),
    }
  );

  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return 0;
}

// ── Incremental rebuild (WIKI_INCREMENTAL) ────────────────────────────────

/**
 * Ask the model where newly added sources belong (existing pages vs new ones).
 * Throws on unusable output; the caller falls back to a full re-plan.
 */
async function routeNewSources(
  addedDocs: SourceDoc[],
  priorPages: IndexPage[],
  codeWikiCatalog: string
): Promise<RoutingPlan> {
  const existingPages = priorPages
    .map((p) => `${p.id} — ${p.title}: ${p.description}`)
    .join("\n");
  const newDocs = addedDocs
    .map((d) => {
      const preview = Array.from(d.body.trim())
        .slice(0, CORPUS_PREVIEW_CHARS)
        .join("");
      return `<doc path="${d.key}">\n${preview}\n</doc>`;
    })
    .join("\n\n");

  const prompt = fmt(ROUTE_PROMPT, {
    existing_pages: existingPages || "(none)",
    new_docs: newDocs,
    code_wikis: codeWikiCatalog || "(none)",
  });
  const raw = await invokeLlm(prompt);
  return parseRouting(extractRouting(raw));
}

/**
 * Returns a status code (0/1) when the run was handled incrementally, or null
 * to signal the caller to fall back to a full re-plan (first run / missing
 * prior state / unusable routing).
 */
async function tryIncremental(
  entries: Entry[],
  codeWikiCatalog: string,
  startedAt: string,
  t0: number
): Promise<number | null> {
  const manifestNow = buildManifest(entries);
  const priorMeta = await readPriorMeta();
  const priorManifest = priorMeta.source_manifest as
    | Record<string, string>
    | undefined;
  const priorIndex = await readPriorIndex();
  if (!priorManifest || !priorIndex || !Array.isArray(priorIndex.pages)) {
    return null;
  }
  const priorPages = priorIndex.pages as IndexPage[];

  const diff = diffManifest(priorManifest, manifestNow);
  if (!diff.changed.length && !diff.added.length && !diff.deleted.length) {
    console.log(
      `Corpus unchanged since last regen (${priorMeta.finished_at ?? "?"}). Skipping.`
    );
    return 0;
  }
  console.log(
    `Incremental: ${diff.changed.length} changed, ${diff.added.length} added, ` +
      `${diff.deleted.length} deleted`
  );

  // Route added sources. Load their bodies once (reused as page sources below).
  let routing: RoutingPlan | null = null;
  let addedDocs: SourceDoc[] = [];
  if (diff.added.length) {
    addedDocs = await loadSourceDocs(diff.added);
    try {
      routing = await routeNewSources(addedDocs, priorPages, codeWikiCatalog);
      console.log(
        `  routed ${diff.added.length} new file(s): ` +
          `${routing.newPages.length} new page(s), ` +
          `${routing.assignments.length} assignment(s)`
      );
    } catch (e) {
      console.error(`  [warn] routing failed (${e}) — falling back to full re-plan`);
      return null;
    }
  }

  const plan = planIncremental(priorPages, diff, routing);

  // Report any added files the router didn't place (picked up on next re-plan).
  const placed = new Set<string>();
  for (const p of plan.pages) for (const s of p.sources) placed.add(s);
  const unplaced = diff.added.filter((k) => !placed.has(k));
  if (unplaced.length) {
    console.log(
      `  [warn] ${unplaced.length} new file(s) not placed by routing; ` +
        "will be incorporated on the next full re-plan"
    );
  }

  // Recompute related deterministically across the merged page set — the only
  // way to keep links consistent without re-running the structure pass.
  const rel = relatedFromSources(plan.pages);
  for (const p of plan.pages) p.related = rel.get(p.id) ?? [];

  // Load source bodies for the pages we'll (re)generate (reusing addedDocs).
  const toGenPages = plan.pages.filter((p) => plan.toGen.has(p.id));
  const addedByKey = new Map(addedDocs.map((d) => [d.key, d]));
  const neededKeys = new Set<string>();
  for (const p of toGenPages) {
    for (const s of p.sources) if (!addedByKey.has(s)) neededKeys.add(s);
  }
  const loaded = await loadSourceDocs([...neededKeys]);
  const docsByKey = new Map<string, SourceDoc>();
  for (const d of [...addedDocs, ...loaded]) docsByKey.set(d.key, d);

  const bodies: Record<string, string> = {};
  let i = 0;
  for (const p of toGenPages) {
    i += 1;
    console.log(`Generating ${i}/${toGenPages.length}: ${p.title}`);
    bodies[p.id] = await generatePage(indexPageToSpec(p), docsByKey, codeWikiCatalog);
  }
  if (toGenPages.length === 0) {
    console.log("  no pages need regeneration; refreshing index + manifest only");
  }

  await writeIncrementalOutputs({
    title: priorIndex.title ?? "Wiki",
    description: priorIndex.description ?? "",
    pages: plan.pages,
    regenerated: bodies,
    deletedSlugs: plan.deletedSlugs,
    sourceDocCount: entries.length,
    startedAt,
    corpusSha: computeCorpusSha([...entries].sort(tupleCmp)),
    sourceManifest: manifestNow,
  });

  console.log(
    `Done (incremental: ${toGenPages.length} regenerated, ` +
      `${plan.deletedSlugs.length} deleted) in ${((Date.now() - t0) / 1000).toFixed(1)}s`
  );
  return 0;
}
