"use client";

import * as React from "react";
import "@aws-amplify/ui-react/styles.css";
import { signOut } from "aws-amplify/auth";
import Link from "next/link";
import { BookOpen, ChevronLeft, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { WikiMarkdown } from "@/components/previews/wiki-markdown";

import "@/utils/amplify-client-config";

type WikiPage = {
  id: string;
  title: string;
  description: string;
  slug: string;
  importance: "high" | "medium" | "low";
  sources: string[];
  related: string[];
};

type WikiIndex = {
  title: string;
  description: string;
  pages: WikiPage[];
};

type WikiMeta = {
  generated_at: string;
  finished_at: string;
  source_doc_count: number;
  page_count: number;
  model_id: string;
};

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 min

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

async function fetchIndex(): Promise<{
  index: WikiIndex | null;
  meta: WikiMeta | null;
}> {
  const res = await fetch("/api/wiki/index");
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? "failed to load wiki");
  return { index: j.index ?? null, meta: j.meta ?? null };
}

async function fetchPage(slug: string): Promise<string> {
  const res = await fetch(`/api/wiki/page?slug=${encodeURIComponent(slug)}`);
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? "failed to load page");
  return j.content ?? "";
}

export default function WikiPage() {
  const [index, setIndex] = React.useState<WikiIndex | null>(null);
  const [meta, setMeta] = React.useState<WikiMeta | null>(null);
  const [indexLoaded, setIndexLoaded] = React.useState(false);
  const [userSelectedSlug, setUserSelectedSlug] = React.useState<string | null>(
    null
  );
  const [content, setContent] = React.useState<string>("");
  const [loadedSlug, setLoadedSlug] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  // Default selection is the first page if the user hasn't picked one yet.
  const activeSlug = userSelectedSlug ?? index?.pages[0]?.slug ?? null;
  const contentLoading = activeSlug !== null && loadedSlug !== activeSlug;

  // ── Initial load: index + meta ─────────────────────────────────
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { index, meta } = await fetchIndex();
        if (cancelled) return;
        setIndex(index);
        setMeta(meta);
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setIndexLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Fetch page content when selection changes ──────────────────
  React.useEffect(() => {
    if (!activeSlug || activeSlug === loadedSlug) return;
    let cancelled = false;
    (async () => {
      try {
        const body = await fetchPage(activeSlug);
        if (cancelled) return;
        setContent(body);
        setLoadedSlug(activeSlug);
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSlug, loadedSlug]);

  // ── Refresh flow: RunTask + poll until STOPPED ─────────────────
  async function pollTask(taskArn: string): Promise<void> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const res = await fetch(
        `/api/wiki/refresh?taskArn=${encodeURIComponent(taskArn)}`
      );
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "status poll failed");
      if (j.lastStatus === "STOPPED") {
        if (j.exitCode !== 0) {
          throw new Error(
            `Generator exited with code ${j.exitCode}${
              j.stoppedReason ? ` — ${j.stoppedReason}` : ""
            }`
          );
        }
        return;
      }
    }
    throw new Error("Generator still running after 5 minutes — check ECS logs");
  }

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch("/api/wiki/refresh", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "refresh failed");
      toast.info("Wiki generation started — this usually takes 1-3 minutes");
      await pollTask(j.taskArn);
      toast.success("Wiki regenerated");

      // Reload index + meta, then re-fetch whatever page is open
      const { index: newIndex, meta: newMeta } = await fetchIndex();
      setIndex(newIndex);
      setMeta(newMeta);
      if (activeSlug) {
        try {
          setContent(await fetchPage(activeSlug));
          setLoadedSlug(activeSlug);
        } catch {
          // Page might've been renamed/removed by the regen — clear and
          // let the default-selection logic pick a new first page.
          setLoadedSlug(null);
          setUserSelectedSlug(null);
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  const selectedPage = index?.pages.find((p) => p.slug === activeSlug) ?? null;

  return (
    <main className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Back
            </Button>
          </Link>
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <BookOpen className="h-4 w-4" /> Wiki
            </h1>
            <p className="text-xs text-muted-foreground">
              {index?.description ?? "Read-only synthesis of the knowledge base"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              signOut().then(() => (window.location.href = "/login"))
            }
          >
            Sign out
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Nav sidebar */}
        <aside className="w-72 shrink-0 overflow-y-auto border-r p-3">
          {!indexLoaded ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">Loading…</p>
          ) : !index || index.pages.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">
              No wiki yet. Click{" "}
              <span className="font-medium">Refresh now</span> to generate one.
            </p>
          ) : (
            <nav className="flex flex-col gap-0.5">
              {index.pages.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setUserSelectedSlug(p.slug)}
                  className={`rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent ${
                    p.slug === activeSlug
                      ? "bg-accent font-medium"
                      : "text-muted-foreground"
                  }`}
                >
                  {p.title}
                </button>
              ))}
            </nav>
          )}
        </aside>

        {/* Main content + right-side meta panel */}
        <section className="flex min-w-0 flex-1 overflow-hidden">
          <div className="min-w-0 flex-1 overflow-auto p-8">
            {contentLoading ? (
              <p className="text-sm text-muted-foreground">Loading page…</p>
            ) : selectedPage && content ? (
              <>
                <WikiMarkdown content={content} />
                {selectedPage.sources.length > 0 && (
                  <div className="mt-10 border-t pt-4 text-xs text-muted-foreground">
                    <div className="mb-1 font-semibold uppercase tracking-wide">
                      Synthesized from
                    </div>
                    <ul className="flex flex-wrap gap-x-3 gap-y-1 font-mono">
                      {selectedPage.sources.map((src) => (
                        <li key={src}>{src}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : indexLoaded ? (
              <p className="text-sm text-muted-foreground">
                Select a page from the sidebar.
              </p>
            ) : null}
          </div>

          {/* Right-side "last indexed / refresh" card */}
          <aside className="w-64 shrink-0 overflow-y-auto border-l p-4">
            <div className="rounded-md border p-3 text-sm">
              <div className="mb-1 font-semibold">Refresh this wiki</div>
              {meta ? (
                <>
                  <div className="text-xs text-muted-foreground">
                    Last indexed:
                    <br />
                    <span className="text-foreground">
                      {formatTimestamp(meta.finished_at)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {meta.page_count} page{meta.page_count === 1 ? "" : "s"} from{" "}
                    {meta.source_doc_count} source
                    {meta.source_doc_count === 1 ? "" : "s"}
                  </div>
                </>
              ) : (
                <div className="text-xs text-muted-foreground">
                  Not yet generated.
                </div>
              )}
              <Button
                size="sm"
                className="mt-3 w-full"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <RefreshCw
                  className={`mr-1 h-3.5 w-3.5 ${
                    refreshing ? "animate-spin" : ""
                  }`}
                />
                {refreshing ? "Regenerating…" : "Refresh now"}
              </Button>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
