"use client";

import * as React from "react";
import { FileText, Pencil, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownPreview } from "@/components/previews/markdown-preview";
import { CsvPreview } from "@/components/previews/csv-preview";
import { JsonPreview } from "@/components/previews/json-preview";
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

type Ext = "md" | "csv" | "json" | "other";

function extOf(key: string): Ext {
  const lower = key.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "md";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".json")) return "json";
  return "other";
}

function Preview({ ext, content }: { ext: Ext; content: string }) {
  switch (ext) {
    case "md":
      return <MarkdownPreview content={content} />;
    case "csv":
      return <CsvPreview content={content} />;
    case "json":
      return <JsonPreview content={content} />;
    default:
      return (
        <p className="text-sm text-muted-foreground">
          No preview for this file type. See the Raw tab.
        </p>
      );
  }
}

export function KnowledgeViewer({
  fileKey,
  onDeleted,
}: {
  fileKey: string | null;
  onDeleted: () => void;
}) {
  const [content, setContent] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<string>("");
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  React.useEffect(() => {
    if (!fileKey) {
      setContent(null);
      setEditing(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEditing(false);
    fetch(`/api/files/get?key=${encodeURIComponent(fileKey)}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.error) setError(j.error);
        else setContent(j.content ?? "");
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [fileKey]);

  function startEdit() {
    setDraft(content ?? "");
    setEditing(true);
  }

  async function save() {
    if (!fileKey) return;
    setSaving(true);
    try {
      const res = await fetch("/api/files/put", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: fileKey, content: draft }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "save failed");
      setContent(draft);
      setEditing(false);
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!fileKey) return;
    try {
      const res = await fetch("/api/files/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: fileKey }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "delete failed");
      toast.success("Deleted");
      setConfirmDelete(false);
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  if (!fileKey) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <div className="flex flex-col items-center gap-2 opacity-50">
          <FileText className="h-8 w-8" />
          <span>Select a file to view</span>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (error) {
    return <div className="p-6 text-sm text-destructive">{error}</div>;
  }

  const ext = extOf(fileKey);
  const text = content ?? "";

  return (
    <>
      <div className="flex h-full flex-col">
        <div className="border-b px-4 py-2 flex items-center justify-between gap-4 shrink-0">
          <p className="text-xs font-mono text-muted-foreground truncate flex-1 min-w-0">
            {fileKey}
          </p>

          {editing ? (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                <X className="mr-1 h-3.5 w-3.5" /> Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                <Save className="mr-1 h-3.5 w-3.5" />
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={startEdit}>
                <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>

        {editing ? (
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="flex-1 min-h-0 resize-none rounded-none border-0 font-mono text-sm leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        ) : (
          <Tabs defaultValue="preview" className="flex flex-1 min-h-0 flex-col gap-0">
            <div className="border-b px-4 py-1.5 shrink-0">
              <TabsList>
                <TabsTrigger value="preview">Preview</TabsTrigger>
                <TabsTrigger value="raw">Raw</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="preview" className="flex-1 min-h-0 overflow-auto p-6">
              <Preview ext={ext} content={text} />
            </TabsContent>

            <TabsContent value="raw" className="flex-1 min-h-0 overflow-auto">
              <pre className="p-4 text-sm whitespace-pre-wrap font-mono leading-relaxed">
                {text}
              </pre>
            </TabsContent>
          </Tabs>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription className="font-mono text-xs break-all">
              {fileKey}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
