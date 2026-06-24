"use client";

import * as React from "react";
import { ChevronDown, CornerDownLeft, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { WikiMarkdown } from "@/components/previews/wiki-markdown";
import { cn } from "@/lib/utils";

type Source = { n: number; key: string; score: number | null; text: string };

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  sources?: Source[];
  streaming?: boolean;
};

function SourceList({ sources }: { sources: Source[] }) {
  const [open, setOpen] = React.useState(false);
  if (sources.length === 0) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        No passages retrieved for this query.
      </p>
    );
  }
  return (
    <div className="mt-3 rounded-md border bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform",
            !open && "-rotate-90"
          )}
        />
        Retrieved context · {sources.length} passage
        {sources.length === 1 ? "" : "s"}
      </button>
      {open ? (
        <ul className="space-y-2 border-t px-3 py-2">
          {sources.map((s) => (
            <li key={s.n} className="text-xs">
              <div className="mb-0.5 flex items-center justify-between gap-2">
                <span className="truncate font-mono text-[11px] text-foreground">
                  [{s.n}] {s.key || "(unknown)"}
                </span>
                {s.score != null ? (
                  <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                    {s.score.toFixed(3)}
                  </span>
                ) : null}
              </div>
              <p className="line-clamp-4 whitespace-pre-wrap text-muted-foreground">
                {s.text}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function WikiChat() {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [includeRaw, setIncludeRaw] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);

    const history = messages.map((m) => ({ role: m.role, text: m.text }));
    setMessages((prev) => [
      ...prev,
      { role: "user", text: message },
      { role: "assistant", text: "", streaming: true },
    ]);

    const patchAssistant = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === "assistant") {
            next[i] = fn(next[i]);
            break;
          }
        }
        return next;
      });

    try {
      const res = await fetch("/api/wiki/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history, includeRaw }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          const trimmed = raw.trim();
          if (!trimmed) continue;
          let evt: Record<string, unknown>;
          try {
            evt = JSON.parse(trimmed);
          } catch {
            continue;
          }
          if (evt.type === "sources") {
            patchAssistant((m) => ({ ...m, sources: evt.sources as Source[] }));
          } else if (evt.type === "delta") {
            patchAssistant((m) => ({ ...m, text: m.text + (evt.text as string) }));
          } else if (evt.type === "error") {
            throw new Error((evt.error as string) || "generation error");
          }
        }
      }
      patchAssistant((m) => ({ ...m, streaming: false }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
      patchAssistant((m) => ({
        ...m,
        streaming: false,
        text: m.text || `_Error: ${msg}_`,
      }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
              <Search className="h-5 w-5" />
            </span>
            <div>
              <p className="font-medium text-foreground">Ask this brain</p>
              <p className="mt-1 max-w-xs text-xs">
                Test what the knowledge base retrieves and how it answers. Every
                reply shows the exact passages and similarity scores it used.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary/15 px-3.5 py-2 text-sm">
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex flex-col">
                  <div className="text-sm">
                    {m.text ? (
                      <WikiMarkdown content={m.text} />
                    ) : m.streaming ? (
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Searching the knowledge base…
                      </span>
                    ) : null}
                  </div>
                  {m.sources ? <SourceList sources={m.sources} /> : null}
                </div>
              )
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t bg-background/80 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Ask a question about this brain's knowledge…"
            disabled={busy}
            className="max-h-40 min-h-[40px] flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
          />
          <Button onClick={send} disabled={busy || !input.trim()} size="icon">
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CornerDownLeft className="h-4 w-4" />
            )}
          </Button>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={includeRaw}
              onChange={(e) => setIncludeRaw(e.target.checked)}
              className="h-3.5 w-3.5 rounded border"
            />
            Include raw sources (default: wiki only)
          </label>
          <span>Enter to send · Shift+Enter for newline</span>
        </div>
      </div>
    </div>
  );
}
