/**
 * Deterministic auto-linking (gbrain-inspired, WIKI_AUTOLINK=1 only).
 *
 * Instead of relying on the model's per-run `related_pages` guesses — which
 * drift between runs and cost tokens — derive cross-references deterministically:
 * two pages are related when their source files overlap. The result is stable
 * across runs and free. This is the cheap, stateless slice of gbrain's
 * auto-linked knowledge graph (no graph DB, no entity extraction).
 *
 * OFF by default; when off, the model's related_pages are used unchanged so
 * output matches the Python generator.
 */

import type { PageSpec } from "./structure.js";

/**
 * Map page id → related page ids: two pages are related when their source
 * files overlap. Works on any shape carrying { id, sources }, so both the
 * structure-pass (PageSpec) and incremental (index) paths can share it.
 */
export function relatedFromSources(
  pages: { id: string; sources: string[] }[]
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const a of pages) {
    const aSources = new Set(a.sources);
    const related: string[] = [];
    for (const b of pages) {
      if (b.id === a.id) continue;
      if (b.sources.some((f) => aSources.has(f))) related.push(b.id);
    }
    result.set(a.id, related);
  }
  return result;
}

/** Deterministic related_pages for the structure pass (WIKI_AUTOLINK). */
export function deterministicRelated(specs: PageSpec[]): Map<string, string[]> {
  return relatedFromSources(
    specs.map((s) => ({ id: s.id, sources: s.relevant_files }))
  );
}
