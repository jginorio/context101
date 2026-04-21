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
import { Button } from "@/components/ui/button";

// Load the diff viewer client-side only — it's ~heavy and we don't need
// it during SSR/static render.
const ReactDiffViewer = dynamic(
  () => import("react-diff-viewer-continued"),
  { ssr: false }
);

type ImproveResponse = {
  improved_content: string;
  changes_summary: string[];
  skipped_reason?: string;
};

export function ImproveDialog({
  open,
  fileKey,
  originalContent,
  onOpenChange,
  onAccepted,
}: {
  open: boolean;
  fileKey: string;
  originalContent: string;
  onOpenChange: (open: boolean) => void;
  onAccepted: (newContent: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  const [confirmStart, setConfirmStart] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<ImproveResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  // Reset every time the dialog opens
  React.useEffect(() => {
    if (open) {
      setConfirmStart(true);
      setLoading(false);
      setResult(null);
      setError(null);
      setSaving(false);
    }
  }, [open]);

  async function runImprove() {
    setConfirmStart(false);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/files/improve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: fileKey, content: originalContent }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `improve failed: ${res.status}`);
      setResult(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function accept() {
    if (!result) return;
    setSaving(true);
    try {
      const res = await fetch("/api/files/put", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: fileKey, content: result.improved_content }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "save failed");
      toast.success("Improvements saved");
      onAccepted(result.improved_content);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // ── Step 1: confirmation ─────────────────────────────────────────
  if (confirmStart) {
    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Improve with AI?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This sends the document to Claude Opus 4.7 via Amazon Bedrock.
              It will suggest rewrites — typos, clarity, structure — without
              inventing facts. You&apos;ll see a diff and can accept or
              cancel before anything is saved.
              <br />
              <br />
              <span className="font-mono text-xs">{fileKey}</span>
              <br />
              <span className="text-xs">
                Cost: typically a few cents per improvement call.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                runImprove();
              }}
            >
              <Sparkles className="mr-1 h-3.5 w-3.5" /> Improve
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  // ── Step 2: loading / diff view ─────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="!max-w-[min(1200px,95vw)] flex flex-col max-h-[90vh]"
        showCloseButton={!loading && !saving}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> AI improvements for{" "}
            <span className="font-mono text-xs font-normal text-muted-foreground">
              {fileKey}
            </span>
          </DialogTitle>
          <DialogDescription>
            {loading && "Thinking… Opus typically takes 10–30s."}
            {!loading && result && result.changes_summary.length > 0 && (
              <>
                Changes:
                <ul className="list-disc list-inside mt-1 space-y-0.5">
                  {result.changes_summary.map((c, i) => (
                    <li key={i} className="text-sm">
                      {c}
                    </li>
                  ))}
                </ul>
                {result.skipped_reason && (
                  <p className="mt-2 text-xs italic">
                    Note: {result.skipped_reason}
                  </p>
                )}
              </>
            )}
            {!loading && result && result.changes_summary.length === 0 && (
              <>
                No substantive changes suggested.{" "}
                {result.skipped_reason && (
                  <span className="italic">{result.skipped_reason}</span>
                )}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto rounded-md border">
          {loading && (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              <Sparkles className="mr-2 h-4 w-4 animate-pulse" /> Improving…
            </div>
          )}
          {error && (
            <div className="p-4 text-sm text-destructive">{error}</div>
          )}
          {result && (
            <ReactDiffViewer
              oldValue={originalContent}
              newValue={result.improved_content}
              splitView
              useDarkTheme={resolvedTheme === "dark"}
              hideLineNumbers={false}
              leftTitle="Original"
              rightTitle="Improved"
            />
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
            onClick={accept}
            disabled={loading || saving || !result || !!error}
          >
            {saving
              ? "Saving…"
              : result?.improved_content === originalContent
                ? "No changes to save"
                : "Accept & save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
