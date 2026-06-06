/**
 * Context101 Wiki Generator (TypeScript port).
 *
 * Flow (identical to wiki-generator/generate.py):
 *   1. List .md files from s3://DOCS_BUCKET/ excluding WIKI_PREFIX.
 *   2. No-change guard: hash (key, etag) pairs, skip if unchanged.
 *   3. Build a budgeted, round-robin corpus summary.
 *   4. Call the model with the structure prompt → XML plan.
 *   5. For each page: read the relevant files, call the model → markdown.
 *   6. Write pages + sidecars + _index.json + _meta.json, prune stale pages.
 *
 * Two gbrain-inspired extensions are flag-gated and OFF by default:
 *   • WIKI_AUTOLINK — deterministic related_pages from shared sources.
 *   • WIKI_GAPS     — emit + persist a <gaps> list.
 * With both off, behavior matches the Python generator. See README.md.
 */

import { deterministicRelated } from "./autolink.js";
import {
  CORPUS_PREFIX,
  CORPUS_SUMMARY_MAX_CHARS,
  DOCS_BUCKET,
  MAX_PAGES,
  MIN_PAGES,
  REPO_FULL_NAME,
  WIKI_AUTOLINK,
  WIKI_FORCE,
  WIKI_GAPS,
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
  readPriorMeta,
  type SourceDoc,
  tupleCmp,
} from "./corpus.js";
import { invokeLlm } from "./llm.js";
import { writeWikiOutputs } from "./outputs.js";
import {
  CODE_PAGE_PROMPT,
  CODE_STRUCTURE_PROMPT,
  fmt,
  GAPS_ADDENDUM,
  PAGE_PROMPT,
  STRUCTURE_PROMPT,
} from "./prompts.js";
import {
  extractXml,
  parseGaps,
  parseStructure,
  type PageSpec,
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

  // ── No-change guard ────────────────────────────────────────────────
  // Per-repo code wikis are referenced, not ingested. Load their catalog (for
  // the prompts) and fold each code wiki's _meta.json (key, etag) into the
  // hash so a repo change triggers a refresh of references.
  let codeWikiCatalog = "";
  let codeMetaEntries: Entry[] = [];
  if (WIKI_MODE !== "code") {
    [codeWikiCatalog, codeMetaEntries] = await loadCodeWikiCatalog();
    if (codeMetaEntries.length) {
      console.log(`  ${codeMetaEntries.length} code wiki(s) available to reference`);
    }
  }

  const corpusSha = computeCorpusSha(
    [...entries, ...codeMetaEntries].sort(tupleCmp)
  );
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

  // ── gbrain-inspired extensions (flag-gated) ─────────────────────────
  let gaps: string[] = [];
  if (WIKI_GAPS) {
    gaps = parseGaps(structureXml);
    if (gaps.length) console.log(`  gaps flagged: ${gaps.length}`);
  }
  if (WIKI_AUTOLINK) {
    const rel = deterministicRelated(specs);
    for (const s of specs) s.related_pages = rel.get(s.id) ?? [];
    console.log(
      "  WIKI_AUTOLINK=1 — related_pages computed from shared sources"
    );
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
    { gaps }
  );

  const elapsed = (Date.now() - t0) / 1000;
  console.log(`Done in ${elapsed.toFixed(1)}s`);
  return 0;
}
