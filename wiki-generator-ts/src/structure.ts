/**
 * Structure parsing — port of generate.py's XML extraction and parsing.
 *
 * The Python generator uses xml.etree; here we use fast-xml-parser. The model
 * output is defended the same way (markdown fences, control chars, stray
 * ampersands), and findtext's "(value or default)" fallbacks are replicated,
 * so the parsed structure matches Python for the same model output.
 */

import { writeFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import { XML_DUMP_PATH } from "./config.js";

export interface PageSpec {
  id: string;
  title: string;
  description: string;
  importance: string;
  relevant_files: string[];
  related_pages: string[];
  slug: string; // derived; filename under WIKI_PREFIX
}

const SLUG_RE = /[^a-z0-9]+/g;

export function slugify(title: string): string {
  const slug = title.toLowerCase().replace(SLUG_RE, "-").replace(/^-+|-+$/g, "");
  return slug || "page";
}

// Escape bare '&' that aren't already part of a valid XML entity. The model
// occasionally emits titles like "Findit & Amplia" which would otherwise make
// the parser fail.
const ENTITY_RE = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g;

export function escapeStrayAmpersands(xml: string): string {
  return xml.replace(ENTITY_RE, "&amp;");
}

/**
 * Pull a <tag>...</tag> block out of the model output. Defensive against
 * leading prose, markdown code fences, stray control chars, and unescaped
 * ampersands.
 */
function extractTagged(text: string, tag: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:xml)?\s*/, "");
  cleaned = cleaned.replace(/\s*```$/, "");
  const match = cleaned.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`));
  if (!match) {
    throw new Error(
      `No <${tag}> block in model output. First 400 chars: ${JSON.stringify(
        text.slice(0, 400)
      )}`
    );
  }
  // Strip control chars that break the parser.
  const withoutControls = match[0].replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
  return escapeStrayAmpersands(withoutControls);
}

/** Extract the <wiki_structure> block from a structure-pass response. */
export function extractXml(text: string): string {
  return extractTagged(text, "wiki_structure");
}

/** Extract the <routing> block from a routing-pass response (incremental). */
export function extractRouting(text: string): string {
  return extractTagged(text, "routing");
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false, // keep text as strings (no number coercion)
  parseAttributeValue: false,
  trimValues: false, // we trim ourselves to match Python's explicit .strip()
  processEntities: true,
  isArray: (name) =>
    ["page", "file_path", "related", "gap", "assignment"].includes(name),
});

type XmlNode = Record<string, unknown>;

/** Text content of an element, mirroring ElementTree.findtext's string result. */
function txt(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "#text" in (v as XmlNode)) {
    return String((v as XmlNode)["#text"]);
  }
  return String(v);
}

function childArray(node: unknown, child: string): unknown[] {
  if (node && typeof node === "object" && child in (node as XmlNode)) {
    const v = (node as XmlNode)[child];
    if (v === undefined) return [];
    return Array.isArray(v) ? v : [v];
  }
  return [];
}

export interface ParsedStructure {
  title: string;
  description: string;
  specs: PageSpec[];
}

export function parseStructure(
  xmlText: string,
  validKeys: Set<string>
): ParsedStructure {
  let parsed: XmlNode;
  try {
    parsed = parser.parse(xmlText) as XmlNode;
  } catch (e) {
    // Dump the failing XML for post-mortem so we don't have to re-run the model.
    try {
      writeFileSync(XML_DUMP_PATH, xmlText, "utf8");
      console.error(`  [error] dumped failing XML to ${XML_DUMP_PATH}`);
    } catch {
      /* best-effort */
    }
    throw e;
  }

  const root = parsed.wiki_structure as XmlNode | undefined;
  if (!root || typeof root !== "object") {
    throw new Error("Parsed XML has no <wiki_structure> root");
  }

  const title = (txt(root.title) || "Wiki").trim();
  const description = (txt(root.description) || "").trim();

  if (!("pages" in root)) {
    throw new Error("Structure XML missing <pages>");
  }
  const pageEls = childArray(root.pages, "page") as XmlNode[];

  const usedSlugs = new Set<string>();
  const specs: PageSpec[] = [];
  for (const pageEl of pageEls) {
    const pageId = (pageEl["@_id"] as string) || `page-${specs.length + 1}`;
    const pTitle = (txt(pageEl.title) || "Untitled").trim();
    const pDesc = (txt(pageEl.description) || "").trim();
    const pImportance = (txt(pageEl.importance) || "medium").trim().toLowerCase();

    const relFiles: string[] = [];
    for (const fp of childArray(pageEl.relevant_files, "file_path")) {
      const key = txt(fp).trim();
      if (!key) continue;
      if (!validKeys.has(key)) {
        console.error(
          `  [warn] page ${pageId} references unknown key ${JSON.stringify(
            key
          )} — dropping`
        );
        continue;
      }
      relFiles.push(key);
    }

    const related: string[] = [];
    for (const r of childArray(pageEl.related_pages, "related")) {
      const v = txt(r).trim();
      if (v) related.push(v);
    }

    let slug = slugify(pTitle);
    const base = slug;
    let n = 2;
    while (usedSlugs.has(slug)) {
      slug = `${base}-${n}`;
      n += 1;
    }
    usedSlugs.add(slug);

    specs.push({
      id: pageId,
      title: pTitle,
      description: pDesc,
      importance: pImportance,
      relevant_files: relFiles,
      related_pages: related,
      slug,
    });
  }

  return { title, description, specs };
}

/** Result of the incremental routing pass: where each new source belongs. */
export interface RoutingPlan {
  newPages: { id?: string; title: string; description: string }[];
  assignments: { file: string; target: string }[];
}

/** Parse a <routing> block (incremental new-source routing). */
export function parseRouting(xmlText: string): RoutingPlan {
  const parsed = parser.parse(xmlText) as XmlNode;
  const root = parsed.routing as XmlNode | undefined;
  if (!root || typeof root !== "object") {
    throw new Error("Parsed XML has no <routing> root");
  }
  const newPages = (childArray(root.new_pages, "page") as XmlNode[]).map((p) => ({
    id: (p["@_id"] as string) || undefined,
    title: (txt(p.title) || "Untitled").trim(),
    description: (txt(p.description) || "").trim(),
  }));
  const assignments = (childArray(root.assignments, "assignment") as XmlNode[])
    .map((a) => ({ file: txt(a.file_path).trim(), target: txt(a.target).trim() }))
    .filter((a) => a.file && a.target);
  return { newPages, assignments };
}

/** Parse an optional <gaps> section (only emitted when WIKI_GAPS=1). */
export function parseGaps(xmlText: string): string[] {
  let parsed: XmlNode;
  try {
    parsed = parser.parse(xmlText) as XmlNode;
  } catch {
    return [];
  }
  const root = parsed.wiki_structure as XmlNode | undefined;
  if (!root) return [];
  return childArray(root.gaps, "gap")
    .map((g) => txt(g).trim())
    .filter((x) => x);
}
