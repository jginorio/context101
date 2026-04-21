import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? "us-east-1",
});

// US cross-region inference profile for Claude Opus 4.7.
// (Opus 4.7 doesn't have a global profile yet — only us.* is active.)
const MODEL_ID = "us.anthropic.claude-opus-4-7";

const SYSTEM_PROMPT = `You are an expert technical editor for Context101, a shared team knowledge base queried by AI agents via semantic search. Your job is to improve a single markdown document so it's clearer to read and more retrievable.

RULES
- NEVER invent facts, names, IDs, URLs, numbers, schema details, or technical terms. If something is unclear, preserve it — don't guess.
- Preserve every concrete fact from the original (URLs, code blocks, values, IDs, table rows).
- Keep the author's voice. Don't make it more formal or more casual than the original.
- Keep markdown valid (GFM tables, fenced code blocks, proper heading hierarchy).
- Optimize for retrieval: descriptive headings, explicit subjects (avoid "it" / "they" when the referent isn't obvious), scannable sections.

YOU MAY
- Fix typos and grammar
- Split long paragraphs
- Add or clarify headings so sections are findable by topic
- Convert prose into bullet lists or tables when that improves scannability
- Rewrite ambiguous sentences to be explicit
- Add a one-line opening summary IF the doc doesn't already have a clear opening that answers "what is this about?"

OUTPUT FORMAT
Respond with a single JSON object and nothing else. No preamble, no markdown code fences around the JSON.

Schema:
{
  "improved_content": "<the full improved markdown, drop-in replacement>",
  "changes_summary": ["<change 1>", "<change 2>", "<change 3>"],
  "skipped_reason": "<optional: short note if you made no substantive changes>"
}

If the document is already well-written and doesn't need substantive edits, return it unchanged with an empty "changes_summary" and a "skipped_reason" explaining why.`;

export type ImproveResult = {
  improved_content: string;
  changes_summary: string[];
  skipped_reason?: string;
};

export async function improveDocument(
  filePath: string,
  content: string
): Promise<ImproveResult> {
  const userMessage = `File path: ${filePath}\n\n<document>\n${content}\n</document>`;

  const res = await client.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      system: [{ text: SYSTEM_PROMPT }],
      messages: [
        {
          role: "user",
          content: [{ text: userMessage }],
        },
      ],
      // Note: Claude Opus 4.7 deprecated the `temperature` param — omit it.
      inferenceConfig: {
        maxTokens: 8192,
      },
    })
  );

  const text = res.output?.message?.content?.[0]?.text ?? "";

  // Claude is asked for raw JSON, but occasionally wraps in fences. Strip both.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: ImproveResult;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Claude returned non-JSON output. Raw response (first 300 chars): ${text.slice(0, 300)}`
    );
  }

  if (typeof parsed.improved_content !== "string") {
    throw new Error("Response missing improved_content");
  }
  if (!Array.isArray(parsed.changes_summary)) {
    parsed.changes_summary = [];
  }
  return parsed;
}

// ── Brain audit (Level 2) ─────────────────────────────────────────────

const AUDIT_SYSTEM_PROMPT = `You are a senior knowledge-base editor auditing Context101, a shared team knowledge base queried by AI agents via semantic search. You're looking at ALL the markdown documents in the brain at once. Your job: identify cross-document issues that no single-file review would catch.

LOOK FOR
1. **Overlap**: two or more docs redundantly covering the same topic. Flag only clear, substantial duplication — not incidental topical overlap.
2. **Missing cross-references**: doc A mentions a concrete topic/product/entity that doc B is the canonical source for, but doesn't link to B. Only flag when the referenced doc clearly exists in the corpus.
3. **Inconsistencies**: two or more docs state conflicting facts (numbers, names, definitions, dates). Quote the exact conflicting lines.
4. **Consolidation opportunities**: content scattered across multiple docs that would be clearer centralized in one.

RULES
- Never invent facts. Only cite what's in the documents.
- Be conservative. It's better to miss a real issue than flag a non-issue. Flag only when clear textual evidence exists.
- Provide file_paths exactly as they appear in the <doc path="..."> tags. Do not add, remove, or rename paths.
- For each finding, proposed_fix should be a plain-language description of the concrete change — short and specific ("Add a link from line mentioning Findit in databases.md to domain-knowledge/findit.md"), not abstract ("Improve cross-linking").

OUTPUT
Respond with a single JSON object and nothing else. No preamble, no markdown code fences.

{
  "findings": [
    {
      "id": "kebab-case-slug-max-40-chars",
      "category": "overlap" | "missing_link" | "inconsistency" | "consolidation" | "other",
      "severity": "low" | "medium" | "high",
      "title": "Short headline, max 80 chars",
      "description": "Why this is a problem. Quote evidence from the docs (<= 400 chars).",
      "file_paths": ["relative/path/to/a.md", "relative/path/to/b.md"],
      "proposed_fix": "Concrete, specific change to make."
    }
  ]
}

If you find no substantive issues, return {"findings": []}.`;

export type Finding = {
  id: string;
  category: "overlap" | "missing_link" | "inconsistency" | "consolidation" | "other";
  severity: "low" | "medium" | "high";
  title: string;
  description: string;
  file_paths: string[];
  proposed_fix: string;
};

function stripJsonFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

export async function auditBrain(
  files: { path: string; content: string }[]
): Promise<Finding[]> {
  const body = files
    .map((f) => `<doc path="${f.path}">\n${f.content}\n</doc>`)
    .join("\n\n");

  const userMessage = `Here are all the documents in the brain. Audit them.\n\n${body}`;

  const res = await client.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      system: [{ text: AUDIT_SYSTEM_PROMPT }],
      messages: [{ role: "user", content: [{ text: userMessage }] }],
      inferenceConfig: { maxTokens: 16_384 },
    })
  );

  const text = res.output?.message?.content?.[0]?.text ?? "";
  const cleaned = stripJsonFences(text);

  let parsed: { findings?: Finding[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Claude returned non-JSON output. Raw response (first 300 chars): ${text.slice(0, 300)}`
    );
  }
  if (!Array.isArray(parsed.findings)) return [];
  return parsed.findings;
}

// ── Apply a single finding surgically ─────────────────────────────────

const APPLY_SYSTEM_PROMPT = `You are applying a specific fix to the Context101 brain. Given the original content of one or more files and a description of the fix to apply, return the new content of each file.

RULES
- Only change what's necessary for this specific fix. Don't take the opportunity to do other improvements.
- Preserve all other content exactly as it was — whitespace, formatting, markdown structure.
- Never invent facts.
- Keep markdown valid.
- If a file doesn't need changes for this fix, omit it from the "files" array.

OUTPUT
Respond with a single JSON object and nothing else. No preamble, no markdown code fences.

{
  "files": [
    { "path": "relative/path.md", "new_content": "<full new content>" }
  ]
}`;

export type ApplyResult = {
  files: { path: string; new_content: string }[];
};

export async function applyFinding(
  finding: Finding,
  files: { path: string; content: string }[]
): Promise<ApplyResult> {
  const filesXml = files
    .map((f) => `<file path="${f.path}">\n${f.content}\n</file>`)
    .join("\n\n");

  const userMessage = `THE FIX TO APPLY:\n<finding>\n${JSON.stringify(finding, null, 2)}\n</finding>\n\nTHE FILES (each may or may not be modified):\n${filesXml}`;

  const res = await client.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      system: [{ text: APPLY_SYSTEM_PROMPT }],
      messages: [{ role: "user", content: [{ text: userMessage }] }],
      inferenceConfig: { maxTokens: 16_384 },
    })
  );

  const text = res.output?.message?.content?.[0]?.text ?? "";
  const cleaned = stripJsonFences(text);

  let parsed: ApplyResult;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Claude returned non-JSON output. Raw response (first 300 chars): ${text.slice(0, 300)}`
    );
  }
  if (!Array.isArray(parsed.files)) parsed.files = [];
  return parsed;
}
