"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  Check,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AddSourceDialog } from "@/components/add-source-dialog";
import { AppShell } from "@/components/app-shell";
import { BrainStatusGate } from "@/components/brain-status-gate";
import {
  PROVIDER_GROUPS,
  SOURCE_TYPES,
  TypeIcon,
  type ConnectorType,
} from "@/lib/source-providers";
import { cn } from "@/lib/utils";

type Status =
  | "pending_auth"
  | "connecting"
  | "syncing"
  | "connected"
  | "error";

type Connector = {
  id: string;
  type: ConnectorType;
  status: Status;
  label: string;
  resource_url: string;
  resource_title?: string;
  google_account_email?: string;
  notion_workspace_name?: string;
  github_account_login?: string;
  github_paths?: string[];
  item_count?: number;
  last_synced_at?: string;
  last_error?: string;
  last_error_at?: string;
  created_at: string;
  created_by?: string;
};

function StatusPill({ s }: { s: Status }) {
  const cls = cn(
    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide",
    s === "connected" &&
      "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    s === "syncing" &&
      "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    (s === "pending_auth" || s === "connecting") &&
      "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    s === "error" && "bg-destructive/15 text-destructive"
  );
  return (
    <span className={cls}>
      {s === "syncing" && <Loader2 className="h-3 w-3 animate-spin" />}
      {s.replace("_", " ")}
    </span>
  );
}

export default function SourcesPage() {
  return (
    <React.Suspense fallback={null}>
      <SourcesContent />
    </React.Suspense>
  );
}

function SourcesContent() {
  const search = useSearchParams();

  const [items, setItems] = React.useState<Connector[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [addType, setAddType] = React.useState<ConnectorType | null>(null);

  function openAdd(type?: ConnectorType) {
    setAddType(type ?? null);
    setAddOpen(true);
  }
  const [confirmRemove, setConfirmRemove] = React.useState<Connector | null>(
    null
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/connectors/list");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setItems(j.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  // Surface OAuth success/error toasts from the callback redirect
  React.useEffect(() => {
    const connected = search.get("connected");
    const oauthError = search.get("oauth_error");
    const githubApp = search.get("githubapp");
    if (connected) toast.success("Connected — first sync is running");
    if (oauthError) toast.error(`OAuth: ${oauthError}`);
    if (githubApp === "created")
      toast.success(
        "GitHub App created — add a GitHub source to pick your repos"
      );
    if (githubApp === "installed")
      toast.success("GitHub App installed — repos are now connectable");
    if (githubApp === "error") toast.error("GitHub App setup failed");
  }, [search]);

  // Poll while anything is syncing
  React.useEffect(() => {
    if (!items?.some((i) => i.status === "syncing")) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [items, load]);

  async function syncNow(id: string) {
    try {
      const r = await fetch("/api/connectors/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      toast.success("Sync started");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeConnector(id: string) {
    try {
      const r = await fetch("/api/connectors/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      toast.success("Removed");
      setConfirmRemove(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  const toolbar = (
    <>
      <Button variant="outline" size="sm" onClick={load} disabled={loading}>
        <RefreshCw
          className={cn("sm:mr-1 h-3.5 w-3.5", loading && "animate-spin")}
        />
        <span className="hidden sm:inline">Refresh</span>
      </Button>
      <Button size="sm" onClick={() => openAdd()}>
        <Plus className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Add new source</span>
        <span className="sm:hidden">Add</span>
      </Button>
    </>
  );

  const sourcesPanel = (
    <div className="space-y-1">
      <p className="px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Add a source
      </p>
      <nav className="flex flex-col gap-0.5">
        {PROVIDER_GROUPS.flatMap((g) => g.types).map((t) => (
          <button
            key={t}
            onClick={() => openAdd(t)}
            className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <TypeIcon type={t} className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate">{SOURCE_TYPES[t].menuLabel}</span>
            <Plus className="h-3.5 w-3.5 shrink-0 opacity-50 transition-opacity group-hover:opacity-100" />
          </button>
        ))}
      </nav>
    </div>
  );

  return (
    <AppShell
      title="Data sources"
      subtitle="Connected systems — synced into the brain every 6 hours"
      toolbar={toolbar}
      contextPanel={sourcesPanel}
    >
      <BrainStatusGate>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <article className="mx-auto w-full max-w-4xl space-y-4 px-3 py-4 sm:px-6 sm:py-6">
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {items === null &&
              loading &&
              Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Skeleton className="mt-0.5 h-8 w-8 rounded" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-3 w-64" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}

            {items && items.length === 0 && (
              <Card>
                <CardContent className="p-6 text-center text-sm text-muted-foreground">
                  No data sources yet. Click <strong>Add new source</strong> to
                  connect a Google Sheet, Doc, Slides deck, Notion workspace, or
                  GitHub repo.
                </CardContent>
              </Card>
            )}

            {items?.map((c) => (
              <Card key={c.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="mt-0.5">
                        <TypeIcon type={c.type} />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {c.label}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {c.resource_title ?? c.resource_url}
                        </p>
                      </div>
                    </div>
                    <StatusPill s={c.status} />
                  </div>

                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs sm:gap-x-4">
                    <dt className="text-muted-foreground">Added by</dt>
                    <dd>{c.created_by ?? "unknown"}</dd>
                    <dt className="text-muted-foreground">
                      {c.type === "notion"
                        ? "Notion workspace"
                        : c.type === "github"
                          ? "GitHub user"
                          : "Google account"}
                    </dt>
                    <dd className="truncate">
                      {c.type === "notion"
                        ? (c.notion_workspace_name ?? "—")
                        : c.type === "github"
                          ? (c.github_account_login ?? "—")
                          : (c.google_account_email ?? "—")}
                    </dd>
                    {c.type === "github" && (
                      <>
                        <dt className="text-muted-foreground">Paths</dt>
                        <dd
                          className="truncate font-mono text-[11px]"
                          title={c.github_paths?.join("\n")}
                        >
                          {c.github_paths?.length
                            ? c.github_paths.join(", ")
                            : "whole repo"}
                        </dd>
                      </>
                    )}
                    <dt className="text-muted-foreground">Last synced</dt>
                    <dd>
                      {c.last_synced_at
                        ? new Date(c.last_synced_at).toLocaleString()
                        : "—"}
                    </dd>
                    <dt className="text-muted-foreground">Items</dt>
                    <dd>
                      {typeof c.item_count === "number" ? c.item_count : "—"}
                    </dd>
                  </dl>

                  {c.status === "error" && c.last_error && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                      {c.last_error}
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 border-t pt-1">
                    <a
                      href={c.resource_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Open source <ExternalLink className="h-3 w-3" />
                    </a>
                    <div className="flex-1" />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => syncNow(c.id)}
                      disabled={c.status === "syncing"}
                    >
                      {c.status === "syncing" ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="mr-1 h-3.5 w-3.5" />
                      )}
                      Sync now
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setConfirmRemove(c)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </article>
        </div>

        <AddSourceDialog
          open={addOpen}
          onOpenChange={(v) => {
            setAddOpen(v);
            if (!v) setAddType(null);
          }}
          type={addType}
        />

        <AlertDialog
          open={!!confirmRemove}
          onOpenChange={(v) => !v && setConfirmRemove(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove source?</AlertDialogTitle>
              <AlertDialogDescription>
                This revokes the saved access token, deletes all synced files
                under{" "}
                <code className="font-mono">
                  sources/{confirmRemove?.type}/…
                </code>{" "}
                in S3, and removes the connection. Bedrock will re-index on the
                next PutObject/Delete event.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  if (confirmRemove) removeConnector(confirmRemove.id);
                }}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </BrainStatusGate>
    </AppShell>
  );
}
