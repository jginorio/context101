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

type Mode = "file" | "folder";

export function NewItemDialog({
  open,
  mode,
  parentPrefix,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  mode: Mode;
  parentPrefix: string; // e.g. "", "domain-knowledge/"
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) setName("");
  }, [open]);

  const title = mode === "file" ? "New file" : "New folder";
  const description =
    mode === "file"
      ? `Create a new file${parentPrefix ? ` in ${parentPrefix}` : " at the root"}. Include the extension, e.g. notes.md`
      : `Create a new folder${parentPrefix ? ` inside ${parentPrefix}` : " at the root"}. Lowercase, hyphens over spaces.`;

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const key =
        mode === "folder"
          ? `${parentPrefix}${trimmed.replace(/\/+$/, "")}/.keep`
          : `${parentPrefix}${trimmed}`;
      const res = await fetch("/api/files/put", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, content: "" }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "create failed");
      toast.success(mode === "folder" ? "Folder created" : "File created");
      onOpenChange(false);
      onCreated();
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
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={mode === "file" ? "example.md" : "domain-knowledge"}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
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
          <Button onClick={handleCreate} disabled={saving || !name.trim()}>
            {saving ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
