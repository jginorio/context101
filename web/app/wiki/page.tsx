"use client";

import * as React from "react";
import "@aws-amplify/ui-react/styles.css";
import { signOut } from "aws-amplify/auth";
import Link from "next/link";
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { WikiMarkdown } from "@/components/previews/wiki-markdown";
import { cn } from "@/lib/utils";

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

type CodeWiki = {
  repoSlug: string;
  index: WikiIndex | null;
  meta: WikiMeta | null;
};

// Active selection — null repo = team wiki page; non-null = code-wiki page
type Selection = { repo: string | null; slug: string };

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

function selectionEq(a: Selection | null, b: Selection | null) {
  if (!a || !b) return a === b;
  return a.repo === b.repo && a.slug === b.slug;
}

async function fetchIndex(): Promise<{
  index: WikiIndex | null;
  meta: WikiMeta | null;
  codeWikis: CodeWiki[];
}> {
  const res = await fetch("/api/wiki/index");
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? "failed to load wiki");
  return {
    index: j.index ?? null,
    meta: j.meta ?? null,
    codeWikis: (j.codeWikis ?? []) as CodeWiki[],
  };
}

async function fetchPage(sel: Selection): Promise<string> {
  const params = new URLSearchParams({ slug: sel.slug });
  if (sel.repo) params.set("repo", sel.repo);
  const res = await fetch(`/api/wiki/page?${params.toString()}`);
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? "failed to load page");
  return j.content ?? "";
}

export default function WikiPage() {
  const [index, setIndex] = React.useState<WikiIndex | null>(null);
  const [meta, setMeta] = React.useState<WikiMeta | null>(null);
  const [codeWikis, setCodeWikis] = React.useState<CodeWiki[]>([]);
  const [indexLoaded, setIndexLoaded] = React.useState(false);
  const [userSelection, setUserSelection] = React.useState<Selection | null>(
    null
  );
  const [content, setContent] = React.useState<string>("");
  const [loadedSelection, setLoadedSelection] =
    React.useState<Selection | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [collapsedRepos, setCollapsedRepos] = React.useState<
    Record<string, boolean>
  >({});

  // Default selection: first team-wiki page if user hasn't picked anything.
  const activeSelection: Selection | null =
    userSelection ??
    (index?.pages[0] ? { repo: null, slug: index.pages[0].slug } : null);
  const contentLoading =
    activeSelection !== null && !selectionEq(loadedSelection, activeSelection);

  // The page object behind the active selection (for the "Synthesized from"
  // footer + right-panel meta).
  const activePage: WikiPage | null = React.useMemo(() => {
    if (!activeSelection) return null;
    if (activeSelection.repo === null) {
      return (
        index?.pages.find((p) => p.slug === activeSelection.slug) ?? null
      );
    }
    const cw = codeWikis.find((c) => c.repoSlug === activeSelection.repo);
    return (
      cw?.index?.pages.find((p) => p.slug === activeSelection.slug) ?? null
    );
  }, [activeSelection, index, codeWikis]);

  // Right-panel meta tracks whichever wiki the active page belongs to.
  const activeMeta: WikiMeta | null = React.useMemo(() => {
    if (!activeSelection || activeSelection.repo === null) return meta;
    return (
      codeWikis.find((c) => c.repoSlug === activeSelection.repo)?.meta ?? null
    );
  }, [activeSelection, meta, codeWikis]);

  // Title for the right-panel "Refresh this wiki" card.
  const activeWikiLabel: string =
    !activeSelection || activeSelection.repo === null
      ? "Refresh team wiki"
      : `Refresh ${activeSelection.repo}`;

  // ── Initial load ────────────────────────────────────────────────
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { index, meta, codeWikis } = await fetchIndex();
        if (cancelled) return;
        setIndex(index);
        setMeta(meta);
        setCodeWikis(codeWikis);
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
    if (!activeSelection || selectionEq(loadedSelection, activeSelection))
      return;
    let cancelled = false;
    (async () => {
      try {
        const body = await fetchPage(activeSelection);
        if (cancelled) return;
        setContent(body);
        setLoadedSelection(activeSelection);
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSelection, loadedSelection]);

  // ── Refresh flow ─────────────────────────────────────────────────
  // For now, the "Refresh now" button only refreshes the *team* wiki.
  // Code-wiki regen happens automatically on the next github sync; users
  // who need an immediate code-wiki rebuild can hit "Sync now" on the
  // connector card or invoke start-wiki-gen directly.
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

      // Reload everything
      const fresh = await fetchIndex();
      setIndex(fresh.index);
      setMeta(fresh.meta);
      setCodeWikis(fresh.codeWikis);

      // Re-fetch whatever page is open
      if (activeSelection) {
        try {
          setContent(await fetchPage(activeSelection));
          setLoadedSelection(activeSelection);
        } catch {
          // Page might've been renamed/removed — clear, default-selection
          // logic picks a new first page.
          setLoadedSelection(null);
          setUserSelection(null);
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  function toggleRepo(slug: string) {
    setCollapsedRepos((prev) => ({ ...prev, [slug]: !prev[slug] }));
  }

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
            !codeWikis.length ? (
              <p className="px-2 py-2 text-sm text-muted-foreground">
                No wiki yet. Click{" "}
                <span className="font-medium">Refresh now</span> to generate
                one.
              </p>
            ) : null
          ) : (
            <div className="mb-4">
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Team wiki
              </p>
              <nav className="flex flex-col gap-0.5">
                {index.pages.map((p) => {
                  const isActive =
                    activeSelection?.repo === null &&
                    activeSelection.slug === p.slug;
                  return (
                    <button
                      key={p.id}
                      onClick={() =>
                        setUserSelection({ repo: null, slug: p.slug })
                      }
                      className={cn(
                        "rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                        isActive
                          ? "bg-accent font-medium"
                          : "text-muted-foreground"
                      )}
                    >
                      {p.title}
                    </button>
                  );
                })}
              </nav>
            </div>
          )}

          {/* Code wikis section — one collapsible group per connected repo */}
          {indexLoaded && codeWikis.length > 0 && (
            <div>
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Code wikis
              </p>
              <div className="space-y-1">
                {codeWikis.map((cw) => {
                  const collapsed = !!collapsedRepos[cw.repoSlug];
                  const idx = cw.index;
                  return (
                    <div key={cw.repoSlug}>
                      <button
                        onClick={() => toggleRepo(cw.repoSlug)}
                        className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-xs hover:bg-accent"
                      >
                        {collapsed ? (
                          <ChevronRight className="h-3 w-3 shrink-0" />
                        ) : (
                          <ChevronDown className="h-3 w-3 shrink-0" />
                        )}
                        <Code2 className="h-3 w-3 shrink-0 opacity-70" />
                        <span className="truncate font-mono text-[11px]">
                          {cw.repoSlug}
                        </span>
                      </button>
                      {!collapsed && idx && (
                        <nav className="ml-4 flex flex-col gap-0.5 border-l pl-2">
                          {idx.pages.map((p) => {
                            const isActive =
                              activeSelection?.repo === cw.repoSlug &&
                              activeSelection.slug === p.slug;
                            return (
                              <button
                                key={p.id}
                                onClick={() =>
                                  setUserSelection({
                                    repo: cw.repoSlug,
                                    slug: p.slug,
                                  })
                                }
                                className={cn(
                                  "rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-accent",
                                  isActive
                                    ? "bg-accent font-medium"
                                    : "text-muted-foreground"
                                )}
                              >
                                {p.title}
                              </button>
                            );
                          })}
                        </nav>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </aside>

        {/* Main content + right-side meta panel */}
        <section className="flex min-w-0 flex-1 overflow-hidden">
          <div className="min-w-0 flex-1 overflow-auto p-8">
            {contentLoading ? (
              <p className="text-sm text-muted-foreground">Loading page…</p>
            ) : activePage && content ? (
              <>
                {activeSelection?.repo && (
                  <p className="mb-4 inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px] font-mono text-muted-foreground">
                    <Code2 className="h-3 w-3" />
                    code wiki · {activeSelection.repo}
                  </p>
                )}
                <WikiMarkdown content={content} />
                {activePage.sources.length > 0 && (
                  <div className="mt-10 border-t pt-4 text-xs text-muted-foreground">
                    <div className="mb-1 font-semibold uppercase tracking-wide">
                      Synthesized from
                    </div>
                    <ul className="flex flex-wrap gap-x-3 gap-y-1 font-mono">
                      {activePage.sources.map((src) => (
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
              <div className="mb-1 font-semibold">{activeWikiLabel}</div>
              {activeMeta ? (
                <>
                  <div className="text-xs text-muted-foreground">
                    Last indexed:
                    <br />
                    <span className="text-foreground">
                      {formatTimestamp(activeMeta.finished_at)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {activeMeta.page_count} page
                    {activeMeta.page_count === 1 ? "" : "s"} from{" "}
                    {activeMeta.source_doc_count} source
                    {activeMeta.source_doc_count === 1 ? "" : "s"}
                  </div>
                </>
              ) : (
                <div className="text-xs text-muted-foreground">
                  Not yet generated.
                </div>
              )}
              {/* Refresh button — only for team wiki for now. Code wikis
                  regenerate automatically when their connector syncs. */}
              {(!activeSelection || activeSelection.repo === null) && (
                <Button
                  size="sm"
                  className="mt-3 w-full"
                  onClick={handleRefresh}
                  disabled={refreshing}
                >
                  <RefreshCw
                    className={cn(
                      "mr-1 h-3.5 w-3.5",
                      refreshing && "animate-spin"
                    )}
                  />
                  {refreshing ? "Regenerating…" : "Refresh now"}
                </Button>
              )}
              {activeSelection?.repo && (
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Code wikis regenerate automatically on the next connector
                  sync (every 6h, or when you click <em>Sync now</em> on the
                  connector card).
                </p>
              )}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
