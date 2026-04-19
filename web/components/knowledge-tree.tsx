"use client";

import * as React from "react";
import { ChevronRight, ChevronDown, FileText, Folder } from "lucide-react";

import { cn } from "@/lib/utils";

type Entry =
  | { type: "folder"; key: string; name: string }
  | { type: "file"; key: string; name: string; size: number; modified: string | null };

type ListResponse = {
  prefix: string;
  folders: Extract<Entry, { type: "folder" }>[];
  files: Extract<Entry, { type: "file" }>[];
};

async function fetchList(prefix: string): Promise<ListResponse> {
  const r = await fetch(`/api/files/list?prefix=${encodeURIComponent(prefix)}`);
  if (!r.ok) throw new Error(`list ${prefix} failed: ${r.status}`);
  return r.json();
}

function FolderNode({
  prefix,
  name,
  depth,
  selectedKey,
  onSelectFile,
}: {
  prefix: string;
  name: string;
  depth: number;
  selectedKey: string | null;
  onSelectFile: (key: string) => void;
}) {
  const [open, setOpen] = React.useState(depth === 0);
  const [data, setData] = React.useState<ListResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || data) return;
    fetchList(prefix)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [open, data, prefix]);

  return (
    <div>
      {depth > 0 && (
        <button
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "flex items-center gap-1.5 w-full text-sm py-1 px-2 rounded hover:bg-muted",
            "text-left"
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" />
          )}
          <Folder className="h-3.5 w-3.5 shrink-0 opacity-70" />
          <span>{name}</span>
        </button>
      )}
      {open && (
        <div>
          {error && (
            <p
              className="text-xs text-destructive px-2 py-1"
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              {error}
            </p>
          )}
          {data?.folders.map((f) => (
            <FolderNode
              key={f.key}
              prefix={f.key}
              name={f.name}
              depth={depth + 1}
              selectedKey={selectedKey}
              onSelectFile={onSelectFile}
            />
          ))}
          {data?.files.map((file) => (
            <button
              key={file.key}
              onClick={() => onSelectFile(file.key)}
              className={cn(
                "flex items-center gap-1.5 w-full text-sm py-1 px-2 rounded hover:bg-muted text-left",
                selectedKey === file.key && "bg-muted"
              )}
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
              <span className="truncate">{file.name}</span>
            </button>
          ))}
          {data && data.folders.length === 0 && data.files.length === 0 && (
            <p
              className="text-xs text-muted-foreground italic px-2 py-1"
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              empty
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function KnowledgeTree({
  selectedKey,
  onSelectFile,
}: {
  selectedKey: string | null;
  onSelectFile: (key: string) => void;
}) {
  return (
    <div className="space-y-0.5">
      <FolderNode
        prefix=""
        name="/"
        depth={0}
        selectedKey={selectedKey}
        onSelectFile={onSelectFile}
      />
    </div>
  );
}
