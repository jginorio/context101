"use client";

import * as React from "react";
import { Check, Filter, GitCompare, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AppShell } from "@/components/app-shell";
import { BrainStatusGate } from "@/components/brain-status-gate";
import { ConflictReviewSheet } from "@/components/conflict-review-sheet";
import { cn } from "@/lib/utils";
import type { ClientConflict } from "@/lib/conflicts/types";

type Status = "pending" | "accepted" | "rejected" | "all";
const TABS: { label: string; value: Status }[] = [
  { label: "Pending", value: "pending" },
  { label: "Accepted", value: "accepted" },
  { label: "Rejected", value: "rejected" },
  { label: "All", value: "all" },
];

export default function ConflictsPage() {
  const [status, setStatus] = React.useState<Status>("pending");
  const [items, setItems] = React.useState<ClientConflict[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState<ClientConflict | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/conflicts/list?status=${status}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setItems(j.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [status]);

  React.useEffect(() => {
    load();
  }, [load]);

  const filtered = React.useMemo(() => {
    if (!items) return [];
    const s = search.trim().toLowerCase();
    if (!s) return items;
    return items.filter((i) => {
      return (
        i.title.toLowerCase().includes(s) ||
        i.topic.toLowerCase().includes(s) ||
        i.left.key.toLowerCase().includes(s) ||
        i.right.key.toLowerCase().includes(s) ||
        i.left.claim.toLowerCase().includes(s) ||
        i.right.claim.toLowerCase().includes(s)
      );
    });
  }, [items, search]);

  async function quickKeep(item: ClientConflict, winner: "left" | "right") {
    const loser = winner === "left" ? item.right : item.left;
    if (loser.unwritable) {
      toast.error("The losing source cannot be written back yet.");
      return;
    }
    try {
      const r = await fetch("/api/conflicts/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          kind: "keep",
          winner,
          loserBody:
            winner === "left"
              ? item.proposed_loser_body.right
              : item.proposed_loser_body.left,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "approve failed");
      toast.success("Approved");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  async function quickReject(id: string) {
    try {
      const r = await fetch("/api/conflicts/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "reject failed");
      toast.success("Rejected");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  const filterPanel = (
    <div className="space-y-1">
      <p className="px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Status
      </p>
      <nav className="flex flex-col gap-0.5">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setStatus(t.value)}
            className={cn(
              "rounded-md px-2 py-1.5 text-left text-sm transition-colors",
              status === t.value
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );

  return (
    <AppShell
      title="Conflicts"
      subtitle="Two sources that disagree. Review, write the loser, or dismiss."
      contextPanel={filterPanel}
    >
      <BrainStatusGate>
      <div className="mx-auto w-full max-w-6xl px-3 sm:px-6 py-4 sm:py-6 space-y-4 flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-end gap-2">
          <div className="relative flex-1 sm:flex-initial">
            <Filter className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conflicts…"
              className="h-8 pl-7 w-full sm:w-64"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
            className="shrink-0"
          >
            <RefreshCw
              className={cn("sm:mr-1 h-3.5 w-3.5", loading && "animate-spin")}
            />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="rounded-md border overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Topic</TableHead>
                <TableHead className="hidden lg:table-cell">Sides</TableHead>
                <TableHead className="hidden md:table-cell">Created</TableHead>
                <TableHead className="w-[120px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading &&
                items === null &&
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-48" />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Skeleton className="ml-auto h-4 w-16" />
                    </TableCell>
                  </TableRow>
                ))}
              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center py-10 text-sm text-muted-foreground"
                  >
                    {search
                      ? "No conflicts match your search."
                      : status === "pending"
                        ? "No pending conflicts. Query and ingest report disagreements here."
                        : `No ${status} conflicts.`}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((c) => (
                <TableRow
                  key={c.id}
                  onClick={() => {
                    setSelected(c);
                    setSheetOpen(true);
                  }}
                  className="cursor-pointer"
                >
                  <TableCell className="align-top">
                    <div className="font-medium text-sm flex items-center gap-1.5">
                      <GitCompare className="h-3 w-3 opacity-60" />
                      <span>{truncate(c.title || c.topic, 60)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {c.topic}
                    </p>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell align-top max-w-[360px]">
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {truncate(c.left.claim, 80)} vs {truncate(c.right.claim, 80)}
                    </p>
                    <p className="text-[10px] font-mono text-muted-foreground mt-1 truncate">
                      {c.left.label} · {c.right.label}
                    </p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell align-top whitespace-nowrap text-xs">
                    {new Date(c.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </TableCell>
                  <TableCell className="align-top text-right">
                    {c.status === "pending" ? (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            quickKeep(c, "left");
                          }}
                          title="Keep left"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            quickReject(c.id);
                          }}
                          title="Reject"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <span
                        className={cn(
                          "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded",
                          c.status === "accepted"
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {c.status}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <ConflictReviewSheet
        conflict={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onActioned={load}
      />
      </BrainStatusGate>
    </AppShell>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
