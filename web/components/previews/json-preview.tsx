"use client";

import * as React from "react";

export function JsonPreview({ content }: { content: string }) {
  const pretty = React.useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return null;
    }
  }, [content]);

  if (pretty === null) {
    return (
      <div>
        <p className="text-sm text-destructive mb-2">Invalid JSON — showing raw content.</p>
        <pre className="text-xs font-mono whitespace-pre-wrap">{content}</pre>
      </div>
    );
  }

  return (
    <pre className="text-xs font-mono whitespace-pre-wrap rounded-md border bg-muted/30 p-4">
      {pretty}
    </pre>
  );
}
