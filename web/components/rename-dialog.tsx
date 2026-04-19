"use client";

import * as React from "react";
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

export function RenameDialog({
  open,
  currentKey,
  isFolder,
  onOpenChange,
  onRenamed,
}: {
  open: boolean;
  currentKey: string; // "foo/bar.md" or "foo/bar/" for folders
  isFolder: boolean;
  onOpenChange: (open: boolean) => void;
  onRenamed: (newKey: string) => void;
}) {
  const [name, setName] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    // Preload the last segment as the default
    const trimmed = isFolder ? currentKey.replace(/\/$/, "") : currentKey;
    const segs = trimmed.split("/");
    setName(segs[segs.length - 1] ?? "");
  }, [open, currentKey, isFolder]);

  async function handleRename() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const segs = (isFolder ? currentKey.replace(/\/$/, "") : currentKey).split(
        "/"
      );
      segs[segs.length - 1] = trimmed.replace(/\/+$/, "");
      const newKey = segs.join("/") + (isFolder ? "/" : "");
      if (newKey === currentKey) {
        onOpenChange(false);
        return;
      }
      const res = await fetch("/api/files/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: currentKey, to: newKey }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "rename failed");
      toast.success("Renamed");
      onOpenChange(false);
      onRenamed(newKey);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename {isFolder ? "folder" : "file"}</DialogTitle>
          <DialogDescription className="font-mono text-xs break-all">
            {currentKey}
          </DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRename();
          }}
        />
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleRename} disabled={saving || !name.trim()}>
            {saving ? "Renaming…" : "Rename"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
