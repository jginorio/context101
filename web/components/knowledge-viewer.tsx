"use client";

import * as React from "react";
import { FileText } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MarkdownPreview } from "@/components/previews/markdown-preview";
import { CsvPreview } from "@/components/previews/csv-preview";
import { JsonPreview } from "@/components/previews/json-preview";

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
          No preview available for this file type. See the Raw tab.
        </p>
      );
  }
}

export function KnowledgeViewer({ fileKey }: { fileKey: string | null }) {
  const [content, setContent] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!fileKey) {
      setContent(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
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
    <Tabs defaultValue="preview" className="flex h-full flex-col gap-0">
      <div className="border-b px-4 py-2 flex items-center justify-between gap-4 shrink-0">
        <p className="text-xs font-mono text-muted-foreground truncate">
          {fileKey}
        </p>
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
  );
}
