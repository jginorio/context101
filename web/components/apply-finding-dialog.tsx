"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "next-themes";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Finding } from "@/utils/bedrock";

const ReactDiffViewer = dynamic(
  () => import("react-diff-viewer-continued"),
  { ssr: false }
);

type Diff = {
  path: string;
  original_content: string;
  new_content: string;
  changed: boolean;
};

export function ApplyFindingDialog({
  open,
  finding,
  onOpenChange,
  onApplied,
}: {
  open: boolean;
  finding: Finding;
  onOpenChange: (open: boolean) => void;
  onApplied: () => void;
}) {
  const { resolvedTheme } = useTheme();
  const [loading, setLoading] = React.useState(false);
  const [diffs, setDiffs] = React.useState<Diff[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setDiffs([]);
    setError(null);
    (async () => {
      try {
        const r = await fetch("/api/brain/apply-finding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ finding }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `apply failed: ${r.status}`);
        if (cancelled) return;
        setDiffs(j.diffs ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, finding]);

  const changed = diffs.filter((d) => d.changed);

  async function acceptAll() {
    if (changed.length === 0) return;
    setSaving(true);
    let ok = 0;
    const fails: string[] = [];
    for (const d of changed) {
      try {
        const r = await fetch("/api/files/put", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: d.path, content: d.new_content }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `save ${d.path} failed`);
        ok++;
      } catch (e) {
        fails.push(`${d.path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setSaving(false);
    if (fails.length === 0) {
      toast.success(`Applied to ${ok} file(s)`);
      onOpenChange(false);
      onApplied();
    } else {
      toast.error(
        `Saved ${ok}, ${fails.length} failed:\n${fails.join("\n")}`
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="!max-w-[min(1200px,95vw)] flex flex-col max-h-[90vh]"
        showCloseButton={!loading && !saving}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> {finding.title}
          </DialogTitle>
          <DialogDescription>
            <span className="text-sm">{finding.proposed_fix}</span>
            {changed.length > 0 && !loading && (
              <span className="block mt-1 text-xs">
                {changed.length} file(s) will change.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto space-y-4">
          {loading && (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              <Sparkles className="mr-2 h-4 w-4 animate-pulse" /> Generating
              diff…
            </div>
          )}
          {error && (
            <div className="p-4 text-sm text-destructive">{error}</div>
          )}
          {!loading &&
            !error &&
            diffs.map((d) => (
              <div key={d.path} className="rounded-md border">
                <div className="border-b px-3 py-1.5 bg-muted/30">
                  <p className="text-xs font-mono">{d.path}</p>
                  {!d.changed && (
                    <p className="text-[10px] text-muted-foreground italic">
                      (no changes proposed)
                    </p>
                  )}
                </div>
                {d.changed && (
                  <ReactDiffViewer
                    oldValue={d.original_content}
                    newValue={d.new_content}
                    splitView
                    useDarkTheme={resolvedTheme === "dark"}
                    leftTitle="Original"
                    rightTitle="Proposed"
                  />
                )}
              </div>
            ))}
          {!loading && !error && changed.length === 0 && diffs.length > 0 && (
            <div className="p-4 text-sm text-muted-foreground">
              Claude didn&apos;t propose any changes for this finding.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading || saving}
          >
            Cancel
          </Button>
          <Button
            onClick={acceptAll}
            disabled={loading || saving || changed.length === 0 || !!error}
          >
            {saving
              ? `Saving… (${changed.length})`
              : changed.length === 0
                ? "Nothing to save"
                : `Accept & save (${changed.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
