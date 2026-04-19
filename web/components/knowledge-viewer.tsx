"use client";

import * as React from "react";
import { FileText } from "lucide-react";

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
    return (
      <div className="p-6 text-sm text-muted-foreground">Loading…</div>
    );
  }

  if (error) {
    return <div className="p-6 text-sm text-destructive">{error}</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-2">
        <p className="text-xs font-mono text-muted-foreground truncate">
          {fileKey}
        </p>
      </div>
      <pre className="flex-1 overflow-auto p-4 text-sm whitespace-pre-wrap font-mono leading-relaxed">
        {content}
      </pre>
    </div>
  );
}
