"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Brain,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  FlaskConical,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useBrain, type ClientBrain } from "@/lib/brain-context";
import {
  defaultEmbeddingSelection,
  EmbeddingControls,
  type EmbeddingSelection,
} from "@/components/settings/embedding-controls";

const MCP_HOST = process.env.NEXT_PUBLIC_MCP_HOST ?? "";

function brainMcpUrl(brainId: string): string {
  if (!MCP_HOST) return `<unknown>/brain/${brainId}/mcp`;
  return `${MCP_HOST.replace(/\/$/, "")}/brain/${brainId}/mcp`;
}

function StatusBadge({ status }: { status: ClientBrain["status"] }) {
  if (status === "ready")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> Ready
      </span>
    );
  if (status === "provisioning")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Provisioning…
      </span>
    );
  if (status === "deleting")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Deleting…
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
      <AlertCircle className="h-3.5 w-3.5" /> Error
    </span>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success(`${label} copied`);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast.error("Copy failed");
        }
      }}
    >
      {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

/**
 * Reveal-on-demand panel for a brain's bearer token + a ready-to-paste
 * MCP client config snippet. Token isn't fetched until the user clicks
 * "Show token" — it stays in Secrets Manager + SSR until then.
 */
function BrainCredentials({ brain }: { brain: ClientBrain }) {
  const url = brainMcpUrl(brain.brain_id);
  const [token, setToken] = React.useState<string | null>(null);
  const [shown, setShown] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  async function loadToken() {
    if (token) {
      setShown((v) => !v);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(
        `/api/brains/${encodeURIComponent(brain.brain_id)}/token`
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setToken(j.token ?? "");
      setShown(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // Claude Desktop only speaks stdio — wrap the HTTP URL in mcp-remote.
  // Cursor / Claude Code accept the bare URL+headers shape directly.
  const snippetHttp = `"${brain.brain_id}": {
  "url": "${url}",
  "headers": {
    "Authorization": "Bearer ${token ?? "<bearer-token>"}"
  }
}`;
  const snippetStdio = `"${brain.brain_id}": {
  "command": "npx",
  "args": [
    "-y",
    "mcp-remote",
    "${url}",
    "--header",
    "Authorization: Bearer ${token ?? "<bearer-token>"}"
  ]
}`;

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-md border bg-background px-2 py-1.5 font-mono text-xs">
          {url}
        </code>
        <CopyButton value={url} label="MCP URL" />
      </div>

      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-md border bg-background px-2 py-1.5 font-mono text-xs">
          {!token
            ? "Bearer token — click Show to reveal"
            : shown
              ? token
              : "•".repeat(Math.min(40, token.length))}
        </code>
        <Button
          size="sm"
          variant="outline"
          onClick={loadToken}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : shown ? (
            <EyeOff className="mr-1 h-3.5 w-3.5" />
          ) : (
            <Eye className="mr-1 h-3.5 w-3.5" />
          )}
          {shown ? "Hide" : "Show"}
        </Button>
        {token ? (
          <CopyButton value={token} label="Bearer token" />
        ) : null}
      </div>

      {token ? (
        <details className="text-xs">
          <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
            Copy as MCP client config
          </summary>
          <div className="mt-2 space-y-3">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium">
                  Cursor / Claude Code / Devin
                </span>
                <CopyButton value={snippetHttp} label="HTTP config" />
              </div>
              <pre className="overflow-x-auto rounded-md border bg-background p-2 font-mono text-[11px] leading-relaxed">
                {snippetHttp}
              </pre>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium">Claude Desktop</span>
                <CopyButton value={snippetStdio} label="stdio config" />
              </div>
              <pre className="overflow-x-auto rounded-md border bg-background p-2 font-mono text-[11px] leading-relaxed">
                {snippetStdio}
              </pre>
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}

function CreateBrainDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [displayName, setDisplayName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [embedding, setEmbedding] = React.useState<EmbeddingSelection>(
    defaultEmbeddingSelection()
  );
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const { setBrain } = useBrain();

  React.useEffect(() => {
    if (!open) {
      setDisplayName("");
      setDescription("");
      setEmbedding(defaultEmbeddingSelection());
      setShowAdvanced(false);
      setSubmitting(false);
    }
  }, [open]);

  async function submit() {
    if (!displayName.trim()) {
      toast.error("Display name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/brains/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName.trim(),
          description: description.trim() || undefined,
          embedding_provider: embedding.provider,
          embedding_model_id: embedding.modelId,
          embedding_dimensions: embedding.dimensions,
          chunking_config: embedding.chunking,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? `Create failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      toast.success(`Brain "${data.brain.display_name}" created`);
      onCreated();
      onOpenChange(false);
      // Switch the header dropdown to the new brain immediately.
      if (data.brain?.brain_id) setBrain(data.brain.brain_id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create a brain</DialogTitle>
          <DialogDescription>
            A brain has its own docs bucket, knowledge base, vector index,
            suggestion queue, sources, and MCP URL — fully isolated from
            other brains. Provisioning takes ~30–60 seconds.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Display name</label>
            <Input
              placeholder="Marketing, Engineering, RFCs…"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={80}
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Description (optional)
            </label>
            <Textarea
              placeholder="What goes in this brain?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={500}
              disabled={submitting}
            />
          </div>
          <div className="border-t pt-3">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              disabled={submitting}
              className="flex w-full items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronRight
                className={cn(
                  "h-4 w-4 shrink-0 transition-transform",
                  showAdvanced && "rotate-90"
                )}
              />
              Advanced configuration
            </button>
            {showAdvanced ? (
              <div className="mt-3">
                <p className="mb-2 text-xs text-muted-foreground">
                  Choose the embedding model and, for Cohere, the text chunking
                  strategy. Defaults to AWS Titan Text Embeddings V2 (1024 dims).
                </p>
                <EmbeddingControls
                  value={embedding}
                  onChange={setEmbedding}
                  disabled={submitting}
                />
              </div>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="mr-1 h-3.5 w-3.5" />
            )}
            {submitting ? "Provisioning…" : "Create brain"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteBrainDialog({
  brain,
  onClose,
  onDeleted,
}: {
  brain: ClientBrain | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirmName, setConfirmName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!brain) {
      setConfirmName("");
      setSubmitting(false);
    }
  }, [brain]);

  if (!brain) return null;
  const nameMatch = confirmName.trim() === brain.display_name;

  async function submit() {
    if (!brain) return;
    if (!nameMatch) {
      toast.error("Display name doesn't match");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/brains/${encodeURIComponent(brain.brain_id)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? `Delete failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      toast.success(`Brain "${brain.display_name}" deleted`);
      onDeleted();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={!!brain} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete brain &quot;{brain.display_name}&quot;?</DialogTitle>
          <DialogDescription>
            This permanently removes the brain&apos;s docs bucket (and every file
            in it), Bedrock knowledge base, vector index, suggestions
            queue, connectors, and bearer-token secret. This action cannot
            be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm">
            Type{" "}
            <span className="font-mono font-medium">{brain.display_name}</span>{" "}
            to confirm:
          </label>
          <Input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={brain.display_name}
            disabled={submitting}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={!nameMatch || submitting}
          >
            {submitting ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="mr-1 h-3.5 w-3.5" />
            )}
            {submitting ? "Deleting…" : "Delete brain"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BrainRow({
  brain,
  onDelete,
}: {
  brain: ClientBrain;
  onDelete: () => void;
}) {
  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 shrink-0" />
              <h3 className="text-base font-semibold truncate">
                {brain.display_name}
              </h3>
              <StatusBadge status={brain.status} />
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-1">
              {brain.brain_id}
            </p>
            {brain.description ? (
              <p className="text-sm text-muted-foreground mt-2">
                {brain.description}
              </p>
            ) : null}
            {brain.error_msg ? (
              <p className="text-xs text-red-600 dark:text-red-400 mt-2">
                {brain.error_msg}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {brain.status === "ready" ? (
              <Link
                href={`/settings?section=advanced&brain=${encodeURIComponent(
                  brain.brain_id
                )}`}
              >
                <Button variant="ghost" size="sm" aria-label="Advanced settings">
                  <FlaskConical className="mr-1 h-3.5 w-3.5" /> Advanced
                </Button>
              </Link>
            ) : null}
            {brain.brain_id !== "default" && brain.status !== "deleting" ? (
              // Errored brains must be deletable too — that's the only way
              // to clean up the half-created S3/KB/secret resources from a
              // failed provision. (The provisioner's delete handler tolerates
              // already-gone resources.) Previously gated on status==="ready"
              // which left users stranded on errored rows.
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onDelete}
                aria-label="Delete brain"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>
        {brain.status === "ready" ? <BrainCredentials brain={brain} /> : null}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Created{" "}
            {new Date(brain.created_at).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </span>
          {brain.created_by_email ? <span>by {brain.created_by_email}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default function BrainsPage() {
  const [items, setItems] = React.useState<ClientBrain[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [toDelete, setToDelete] = React.useState<ClientBrain | null>(null);
  const { refreshBrains } = useBrain();

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/brains/list?status=all", { cache: "no-store" });
      const data = await res.json();
      setItems(data?.items ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  // Poll while anything is in flight (provisioning/deleting). Stops once
  // everything settles to a terminal state.
  React.useEffect(() => {
    const inFlight = items.some(
      (b) => b.status === "provisioning" || b.status === "deleting"
    );
    if (!inFlight) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [items, load]);

  return (
    <main className="flex min-h-screen flex-col">
      <header className="border-b px-3 sm:px-6 py-3 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Link href="/knowledge">
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex">
              <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="sm:hidden"
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-semibold tracking-tight truncate">
              Brains
            </h1>
            <p className="text-xs text-muted-foreground hidden sm:block truncate">
              Each brain has its own isolated knowledge base, sources, and MCP URL.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> New brain
          </Button>
        </div>
      </header>

      <section className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 sm:py-8 space-y-4">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4 rounded" />
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <Skeleton className="h-3 w-56" />
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))
        ) : items.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">No brains yet</CardTitle>
            </CardHeader>
            <CardContent>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Create the first brain
              </Button>
            </CardContent>
          </Card>
        ) : (
          items.map((b) => (
            <BrainRow
              key={b.brain_id}
              brain={b}
              onDelete={() => setToDelete(b)}
            />
          ))
        )}
      </section>

      <CreateBrainDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          load();
          refreshBrains();
        }}
      />
      <DeleteBrainDialog
        brain={toDelete}
        onClose={() => setToDelete(null)}
        onDeleted={() => {
          load();
          refreshBrains();
        }}
      />
    </main>
  );
}
