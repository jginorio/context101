import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type Message,
} from "@aws-sdk/client-bedrock-runtime";

import { resolveBrainFromRequest } from "@/lib/brains-server";
import { retrieveSources } from "@/lib/wiki-retrieve";

const region = process.env.AWS_REGION ?? "us-east-1";
const bedrock = new BedrockRuntimeClient({ region });

// US cross-region inference profile for Claude Opus 4.7 — matches utils/bedrock.
const MODEL_ID = "us.anthropic.claude-opus-4-7";
const NUM_RESULTS = 6;

type Source = { n: number; key: string; score: number | null; text: string };
type HistoryTurn = { role: "user" | "assistant"; text: string };

function systemPrompt(brainName: string): string {
  return `You are a retrieval QA assistant for the "${brainName}" knowledge base. You answer questions strictly from the retrieved context passages provided with each question — this is a tool for testing what the knowledge base actually returns.

RULES
- Answer ONLY using the provided context. Do not use outside knowledge.
- Cite the passages you use inline as [1], [2], etc. matching their numbers.
- If the context doesn't contain the answer, say so plainly (e.g. "The knowledge base doesn't cover that") instead of guessing.
- Be concise and concrete. Prefer the wording/terms from the context.`;
}

/**
 * POST /api/wiki/chat
 * Body: { message: string, history?: {role,text}[], includeRaw?: boolean }
 *
 * A retrieval playground for the active brain: runs a Bedrock KB Retrieve
 * (raw-first like the MCP `search_knowledge` tool — everything except code
 * sources; includeRaw lifts that filter so code chunks show too), then
 * streams a grounded Claude answer. Responds as NDJSON so the client can
 * render the retrieved chunks (with scores + source keys) and the streamed
 * answer together:
 *   {"type":"sources","sources":[...]}\n
 *   {"type":"delta","text":"..."}\n   (repeated)
 *   {"type":"done"}\n   |   {"type":"error","error":"..."}\n
 */
export async function POST(request: NextRequest) {
  const resolved = await resolveBrainFromRequest(request);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const brain = resolved.brain;
  if (!brain.kb_id) {
    return NextResponse.json(
      { error: "this brain has no knowledge base yet" },
      { status: 409 }
    );
  }

  const body = await request.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }
  const includeRaw = body?.includeRaw === true;
  const history: HistoryTurn[] = Array.isArray(body?.history)
    ? body.history
        .filter(
          (t: unknown): t is HistoryTurn =>
            !!t &&
            typeof (t as HistoryTurn).text === "string" &&
            ((t as HistoryTurn).role === "user" ||
              (t as HistoryTurn).role === "assistant")
        )
        .slice(-8)
    : [];

  // 1. Retrieve from the brain's KB — mirror the MCP tool's raw-first filter:
  // everything except code (synced repo files + per-repo code wikis). notIn
  // also matches docs with no `source` attribute (manual uploads have no
  // sidecar). includeRaw lifts the filter entirely so code chunks show too.
  let sources: Source[] = [];
  try {
    sources = await retrieveSources({
      knowledgeBaseId: brain.kb_id,
      query: message,
      includeRaw,
      numberOfResults: NUM_RESULTS,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `retrieval failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }

  const context =
    sources.length > 0
      ? sources
          .map(
            (s) =>
              `[${s.n}] ${s.key}${s.score != null ? ` (score ${s.score.toFixed(3)})` : ""}\n${s.text}`
          )
          .join("\n\n---\n\n")
      : "(no passages retrieved)";

  const messages: Message[] = [
    ...history.map(
      (t): Message => ({ role: t.role, content: [{ text: t.text }] })
    ),
    {
      role: "user",
      content: [
        {
          text: `Question: ${message}\n\n<context>\n${context}\n</context>`,
        },
      ],
    },
  ];

  const encoder = new TextEncoder();
  const line = (obj: unknown) => encoder.encode(JSON.stringify(obj) + "\n");

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Emit retrieved context first so the UI can render it immediately.
      controller.enqueue(line({ type: "sources", sources }));
      try {
        const resp = await bedrock.send(
          new ConverseStreamCommand({
            modelId: MODEL_ID,
            system: [{ text: systemPrompt(brain.display_name) }],
            messages,
            inferenceConfig: { maxTokens: 1500 },
          })
        );
        for await (const event of resp.stream ?? []) {
          const text = event.contentBlockDelta?.delta?.text;
          if (text) controller.enqueue(line({ type: "delta", text }));
        }
        controller.enqueue(line({ type: "done" }));
      } catch (err) {
        controller.enqueue(
          line({
            type: "error",
            error: err instanceof Error ? err.message : String(err),
          })
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
