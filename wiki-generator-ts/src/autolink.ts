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

/** Map page id → related page ids, computed from shared source files. */
export function deterministicRelated(specs: PageSpec[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const a of specs) {
    const aSources = new Set(a.relevant_files);
    const related: string[] = [];
    for (const b of specs) {
      if (b.id === a.id) continue;
      if (b.relevant_files.some((f) => aSources.has(f))) related.push(b.id);
    }
    result.set(a.id, related);
  }
  return result;
}
