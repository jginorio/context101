/**
 * Incremental regeneration planning (WIKI_INCREMENTAL).
 *
 * The page→source dependency graph is already persisted in _index.json (each
 * page carries its `sources`). Combined with a per-file etag manifest kept in
 * _meta.json, that's everything needed to regenerate only the pages a corpus
 * change actually touches, instead of rebuilding the whole wiki.
 *
 * This module is pure (no IO): it diffs manifests and computes which pages to
 * regenerate, delete, or create. The orchestration in generate.ts does the S3
 * reads/writes and the LLM calls.
 */

import type { Entry } from "./corpus.js";
import { slugify, type PageSpec, type RoutingPlan } from "./structure.js";

/** A page as stored in _index.json. */
export interface IndexPage {
  id: string;
  title: string;
  description: string;
  slug: string;
  importance: string;
  sources: string[];
  related: string[];
}

export interface ManifestDiff {
  changed: string[];
  added: string[];
  deleted: string[];
}

/** Build a {key: etag} manifest from corpus entries, key-sorted for stable diffs. */
export function buildManifest(entries: Entry[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, e] of [...entries].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0
  )) {
    out[k] = e;
  }
  return out;
}

/** Diff two manifests into changed / added / deleted key sets. */
export function diffManifest(
  prior: Record<string, string>,
  current: Record<string, string>
): ManifestDiff {
  const changed: string[] = [];
  const added: string[] = [];
  const deleted: string[] = [];
  for (const k of Object.keys(current)) {
    if (!(k in prior)) added.push(k);
    else if (prior[k] !== current[k]) changed.push(k);
  }
  for (const k of Object.keys(prior)) {
    if (!(k in current)) deleted.push(k);
  }
  return { changed: changed.sort(), added: added.sort(), deleted: deleted.sort() };
}

export interface IncrementalPlan {
  /** Full merged page set for the new _index.json. */
  pages: IndexPage[];
  /** Ids of pages that must be (re)generated. */
  toGen: Set<string>;
  /** Slugs of pages removed this run (their .md + sidecar are deleted). */
  deletedSlugs: string[];
}

/**
 * Given the prior pages, a manifest diff, and an optional routing result for
 * added sources, compute the new page set, which pages to regenerate, and which
 * to delete. Existing pages keep their id, title, description, and slug — only
 * their content (and sources, on add/delete) changes — so page identity is
 * stable across runs.
 */
export function planIncremental(
  priorPages: IndexPage[],
  diff: ManifestDiff,
  routing: RoutingPlan | null
): IncrementalPlan {
  // Work on a mutable copy.
  const pages: IndexPage[] = priorPages.map((p) => ({
    ...p,
    sources: [...(p.sources ?? [])],
    related: [...(p.related ?? [])],
  }));
  const byId = new Map(pages.map((p) => [p.id, p]));
  const toGen = new Set<string>();

  // ── Deletions: drop the vanished keys from every page's sources. ──
  const deletedSet = new Set(diff.deleted);
  for (const p of pages) {
    const before = p.sources.length;
    p.sources = p.sources.filter((s) => !deletedSet.has(s));
    if (p.sources.length !== before) toGen.add(p.id);
  }
  // A page with no sources left is dropped entirely.
  const deletedSlugs: string[] = [];
  const survivors: IndexPage[] = [];
  for (const p of pages) {
    if (p.sources.length === 0) {
      deletedSlugs.push(p.slug);
      toGen.delete(p.id);
    } else {
      survivors.push(p);
    }
  }
  const survivorIds = new Set(survivors.map((p) => p.id));

  // ── Changed: any surviving page citing a changed key is dirty. ──
  const changedSet = new Set(diff.changed);
  for (const p of survivors) {
    if (p.sources.some((s) => changedSet.has(s))) toGen.add(p.id);
  }

  // ── Added: apply the routing plan. ──
  const newPages: IndexPage[] = [];
  if (routing) {
    const existingSlugs = new Set(survivors.map((p) => p.slug));
    const usedIds = new Set(survivorIds);
    const newByRouterId = new Map<string, IndexPage>();

    let idCounter = 1;
    const mintId = (): string => {
      let id: string;
      do {
        id = `np-${idCounter++}`;
      } while (usedIds.has(id));
      usedIds.add(id);
      return id;
    };

    for (const np of routing.newPages) {
      let slug = slugify(np.title || "page");
      const base = slug;
      let n = 2;
      while (existingSlugs.has(slug)) slug = `${base}-${n++}`;
      existingSlugs.add(slug);
      const page: IndexPage = {
        id: mintId(),
        title: (np.title || "Untitled").trim(),
        description: (np.description || "").trim(),
        slug,
        importance: "medium",
        sources: [],
        related: [],
      };
      // Map the router's proposed id (e.g. "new-1") to the real page.
      newByRouterId.set(np.id ?? page.id, page);
      newPages.push(page);
    }

    for (const a of routing.assignments) {
      const existing = byId.get(a.target);
      if (existing && survivorIds.has(existing.id)) {
        if (!existing.sources.includes(a.file)) existing.sources.push(a.file);
        toGen.add(existing.id);
        continue;
      }
      const np = newByRouterId.get(a.target);
      if (np) {
        if (!np.sources.includes(a.file)) np.sources.push(a.file);
      }
      // Unknown target → silently skipped here; the caller reports unrouted
      // files so they get picked up on the next full re-plan.
    }
  }

  // Keep only new pages that actually received at least one source.
  const keptNew = newPages.filter((p) => p.sources.length > 0);
  for (const p of keptNew) toGen.add(p.id);

  return { pages: [...survivors, ...keptNew], toGen, deletedSlugs };
}

/** Convert a stored index page into the PageSpec shape generatePage expects. */
export function indexPageToSpec(p: IndexPage): PageSpec {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    importance: p.importance,
    relevant_files: p.sources,
    related_pages: p.related,
    slug: p.slug,
  };
}
