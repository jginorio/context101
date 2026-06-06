/**
 * Prompt templates, ported verbatim from wiki-generator/prompts.py.
 *
 * The templates live as .txt files alongside this module (and are copied into
 * dist/ by the build) so backticks, braces, and `${}` in the prompt bodies
 * can't collide with TS string syntax. Placeholders use Python's `{name}`
 * style and are filled by `fmt` below.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function load(name: string): string {
  return readFileSync(join(here, "prompts", name), "utf8");
}

export const STRUCTURE_PROMPT = load("structure.txt");
export const CODE_STRUCTURE_PROMPT = load("code_structure.txt");
export const PAGE_PROMPT = load("page.txt");
export const CODE_PAGE_PROMPT = load("code_page.txt");
// Used only by the incremental path (WIKI_INCREMENTAL) to route newly added
// sources into existing pages or propose new ones.
export const ROUTE_PROMPT = load("route.txt");

/**
 * Fill `{name}` placeholders. Mirrors Python's str.format for the subset we
 * use: every occurrence of a provided key is replaced; extra keys not present
 * in the template are ignored (str.format ignores unused kwargs too). The
 * prompt bodies contain no literal `{`/`}` other than these placeholders.
 */
export function fmt(
  template: string,
  vars: Record<string, string | number>
): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

// Appended to the structure prompt only when WIKI_GAPS=1. Off by default so
// the prompt sent to the model is byte-identical to Python's otherwise.
export const GAPS_ADDENDUM = `

ADDITIONALLY: Just before the closing </wiki_structure> tag, add a <gaps> section listing topics that the documents reference or imply but do not actually cover, so readers know what the knowledge base is missing. Format:
  <gaps>
    <gap>[A specific topic the corpus references but does not document]</gap>
  </gaps>
Include 0-6 gaps grounded only in the corpus above — do not invent generic gaps.`;
