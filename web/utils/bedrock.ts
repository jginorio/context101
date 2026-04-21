import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? "us-east-1",
});

// Global inference profile for Claude Opus 4.7 — broadest availability.
// If your account only has regional profiles, swap to
// "us.anthropic.claude-opus-4-7-v1:0".
const MODEL_ID = "global.anthropic.claude-opus-4-7-v1:0";

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
      inferenceConfig: {
        maxTokens: 8192,
        temperature: 0.3,
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
