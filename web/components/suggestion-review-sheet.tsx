"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Check, FileText, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "next-themes";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarkdownPreview } from "@/components/previews/markdown-preview";

const ReactDiffViewer = dynamic(
  () => import("react-diff-viewer-continued"),
  { ssr: false }
);

type Suggestion = {
  id: string;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
  title: string;
  content: string;
  target_path?: string;
  rationale?: string;
  trigger?: string;
};

export function SuggestionReviewSheet({
  suggestion,
  open,
  onOpenChange,
  onActioned,
}: {
  suggestion: Suggestion | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onActioned: () => void;
}) {
  const { resolvedTheme } = useTheme();
  const [original, setOriginal] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState<"approve" | "reject" | null>(null);
  const [destOverride, setDestOverride] = React.useState("");

  // Load the existing doc if this is an update
  React.useEffect(() => {
    if (!open || !suggestion) {
      setOriginal(null);
      setDestOverride("");
      return;
    }
    setDestOverride(suggestion.target_path ?? "");
    if (!suggestion.target_path) {
      setOriginal(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/files/get?key=${encodeURIComponent(suggestion.target_path)}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setOriginal(j.error ? null : (j.content ?? ""));
      })
      .catch(() => !cancelled && setOriginal(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, suggestion]);

  async function approve() {
    if (!suggestion) return;
    setSaving("approve");
    try {
      const r = await fetch("/api/suggestions/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: suggestion.id,
          target_path: destOverride.trim() || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "approve failed");
      toast.success(`Approved → ${j.destKey}`);
      onOpenChange(false);
      onActioned();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  async function reject() {
    if (!suggestion) return;
    setSaving("reject");
    try {
      const r = await fetch("/api/suggestions/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: suggestion.id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "reject failed");
      toast.success("Rejected");
      onOpenChange(false);
      onActioned();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  if (!suggestion) return null;

  const isUpdate = !!suggestion.target_path;
  const hasOriginal = original !== null;
  const isPending = suggestion.status === "pending";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="!max-w-[min(1000px,95vw)] w-full flex flex-col gap-0 p-0"
      >
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> {suggestion.title}
          </SheetTitle>
          <SheetDescription className="space-y-1">
            <span className="block text-xs">
              {isUpdate ? (
                <>
                  Update to{" "}
                  <code className="font-mono">{suggestion.target_path}</code>
                </>
              ) : (
                <>New document</>
              )}
              {" · "}
              {new Date(suggestion.created_at).toLocaleString()}
            </span>
            {suggestion.trigger && (
              <span className="block text-xs">
                <span className="text-muted-foreground">Trigger: </span>
                {suggestion.trigger}
              </span>
            )}
            {suggestion.rationale && (
              <span className="block text-xs">
                <span className="text-muted-foreground">Rationale: </span>
                {suggestion.rationale}
              </span>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-auto px-4 py-3">
          {loading && (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading original…
            </div>
          )}

          {!loading && isUpdate && hasOriginal && (
            <div className="rounded-md border">
              <div className="border-b px-3 py-1.5 bg-muted/30 text-xs font-mono">
                {suggestion.target_path}
              </div>
              <ReactDiffViewer
                oldValue={original}
                newValue={suggestion.content}
                splitView
                useDarkTheme={resolvedTheme === "dark"}
                leftTitle="Current"
                rightTitle="Proposed"
              />
            </div>
          )}

          {!loading && isUpdate && !hasOriginal && (
            <div className="rounded-md border p-3 text-sm">
              <p className="text-destructive mb-2">
                Could not load the current content at{" "}
                <code className="font-mono">{suggestion.target_path}</code>.
                Showing proposed content as-is.
              </p>
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <MarkdownPreview content={suggestion.content} />
              </div>
            </div>
          )}

          {!loading && !isUpdate && (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-0.5">
                  Destination path
                </p>
                <Input
                  value={destOverride}
                  onChange={(e) => setDestOverride(e.target.value)}
                  placeholder={`${slugify(suggestion.title)}.md`}
                  className="font-mono text-xs h-8"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Leave blank to use the default slug. Include a prefix for a
                  subfolder, e.g.{" "}
                  <code className="font-mono">databases/my-doc.md</code>.
                </p>
              </div>
              <div className="rounded-md border">
                <div className="border-b px-3 py-1.5 bg-muted/30 text-xs font-medium flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" /> Proposed content
                </div>
                <div className="p-4 prose prose-sm max-w-none dark:prose-invert">
                  <MarkdownPreview content={suggestion.content} />
                </div>
              </div>
            </div>
          )}
        </div>

        <SheetFooter className="border-t flex-row gap-2 justify-end">
          {isPending ? (
            <>
              <Button
                variant="outline"
                onClick={reject}
                disabled={saving !== null}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                {saving === "reject" ? "Rejecting…" : "Reject"}
              </Button>
              <Button onClick={approve} disabled={saving !== null}>
                <Check className="mr-1 h-3.5 w-3.5" />
                {saving === "approve" ? "Approving…" : "Approve & save"}
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              This suggestion is already {suggestion.status}.
            </p>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "suggestion"
  );
}
