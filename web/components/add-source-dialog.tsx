"use client";

import * as React from "react";
import { Loader2, Sheet } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AddSourceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [label, setLabel] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setLabel("");
      setUrl("");
      setSubmitting(false);
    }
  }, [open]);

  async function connect() {
    if (!label.trim() || !url.trim()) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/connectors/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "sheets",
          label: label.trim(),
          resource_url: url.trim(),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      if (!j.oauthUrl) throw new Error("No OAuth URL returned");
      // Hand off to Google. We do a full-page navigation so the consent
      // screen replaces the dialog; the callback route redirects us back
      // to /sources with ?connected=<id>.
      window.location.href = j.oauthUrl;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sheet className="h-4 w-4" /> Add a Google Sheet
          </DialogTitle>
          <DialogDescription>
            Paste a spreadsheet URL and give it a friendly label. You&apos;ll
            be redirected to Google to authorize read access. After you
            approve, we pull every tab into the brain as markdown and
            re-sync every 6 hours.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium mb-1">Label</p>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Platea Instagram analytics"
              disabled={submitting}
              autoFocus
            />
          </div>
          <div>
            <p className="text-xs font-medium mb-1">Spreadsheet URL</p>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              disabled={submitting}
              className="font-mono text-xs"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            You only need <strong>Viewer</strong> access on the sheet — the
            sync is read-only.
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={connect}
            disabled={submitting || !label.trim() || !url.trim()}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                Redirecting…
              </>
            ) : (
              "Connect Google account"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
