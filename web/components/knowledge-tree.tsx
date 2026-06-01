"use client";

import * as React from "react";
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Folder,
  FilePlus,
  FolderPlus,
  Download,
} from "lucide-react";
import { toast } from "sonner";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

type Entry =
  | { type: "folder"; key: string; name: string }
  | {
      type: "file";
      key: string;
      name: string;
      size: number;
      modified: string | null;
    };

type ListResponse = {
  prefix: string;
  folders: Extract<Entry, { type: "folder" }>[];
  files: Extract<Entry, { type: "file" }>[];
};

// ── Drag & drop payload ──────────────────────────────────────────────
// We use a single custom MIME type so drag events from outside the app
// (e.g. dragging a .md file from the OS) don't accidentally trigger a
// move. If the payload isn't our MIME type, we don't handle the drop.
export const DRAG_MIME = "application/x-context101";
export type DragPayload = { key: string; isFolder: boolean };

export async function fetchList(prefix: string): Promise<ListResponse> {
  const r = await fetch(`/api/files/list?prefix=${encodeURIComponent(prefix)}`);
  if (!r.ok) throw new Error(`list ${prefix} failed: ${r.status}`);
  return r.json();
}

export async function moveItem(from: string, to: string): Promise<void> {
  const r = await fetch("/api/files/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error ?? `move failed: ${r.status}`);
}

function lastSegment(key: string, isFolder: boolean): string {
  const trimmed = isFolder ? key.replace(/\/$/, "") : key;
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

function downloadBlob(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

async function downloadFile(key: string) {
  try {
    const r = await fetch(`/api/files/get?key=${encodeURIComponent(key)}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `download failed: ${r.status}`);
    downloadBlob(lastSegment(key, false), j.content ?? "");
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  }
}

// ── Tree context shared between nodes ────────────────────────────────

export type TreeContext = {
  selectedKey: string | null;
  refreshKey: number;
  onSelectFile: (key: string) => void;
  onNewFile: (parentPrefix: string) => void;
  onNewFolder: (parentPrefix: string) => void;
  onRename: (key: string, isFolder: boolean) => void;
  onDeleteRequest: (key: string, isFolder: boolean) => void;
  onMoved: () => void; // refresh after a successful move
  // Multi-select for ZIP export. Keys use the S3 convention: files are
  // e.g. "foo/bar.md", folders end with "/".
  checked: Set<string>;
  onToggleCheck: (key: string) => void;
};

// Compute the destination key when dropping `src` into folder `destPrefix`.
// Returns null if the drop should be rejected (same parent, moving folder
// into itself/descendant, etc).
export function computeMoveTarget(
  src: DragPayload,
  destPrefix: string
): string | null {
  const name = lastSegment(src.key, src.isFolder);
  const currentParent = src.isFolder
    ? src.key.slice(0, -(name.length + 1)) // strip "name/"
    : src.key.slice(0, src.key.length - name.length);

  // Same parent = no-op
  if (currentParent === destPrefix) return null;

  // Moving a folder into itself or a descendant
  if (src.isFolder && destPrefix.startsWith(src.key)) return null;

  return src.isFolder ? `${destPrefix}${name}/` : `${destPrefix}${name}`;
}

// ── Folder node (recursive) ──────────────────────────────────────────

export function FolderNode({
  prefix,
  name,
  depth,
  ctx,
  hideRootFolders,
}: {
  prefix: string;
  name: string;
  depth: number;
  ctx: TreeContext;
  // Folder names to hide at depth 0 only (used to keep connector-managed
  // `sources/` and generated `wiki/` out of the "Your files" section).
  hideRootFolders?: string[];
}) {
  const [open, setOpen] = React.useState(depth === 0);
  const [data, setData] = React.useState<ListResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    fetchList(prefix)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [open, prefix, ctx.refreshKey]);

  // ── D&D handlers for dropping into this folder ─────────────────────
  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    let payload: DragPayload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    const to = computeMoveTarget(payload, prefix);
    if (!to) return;
    try {
      await moveItem(payload.key, to);
      toast.success(`Moved to ${prefix || "/"}`);
      ctx.onMoved();
      if (!open) setOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const visibleFolders =
    data?.folders.filter(
      (f) => !(depth === 0 && hideRootFolders?.includes(f.name))
    ) ?? [];

  const header =
    depth === 0 ? null : (
      <ContextMenu>
        <ContextMenuTrigger>
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "flex items-center gap-1 w-full text-sm py-1 px-2 rounded hover:bg-muted",
              dragOver && "bg-accent ring-1 ring-ring"
            )}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
          >
            <Checkbox
              checked={ctx.checked.has(prefix)}
              onCheckedChange={() => ctx.onToggleCheck(prefix)}
              onClick={(e) => e.stopPropagation()}
              className="h-3.5 w-3.5 shrink-0"
              aria-label={`select folder ${name}`}
            />
            <button
              onClick={() => setOpen((o) => !o)}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  DRAG_MIME,
                  JSON.stringify({ key: prefix, isFolder: true } as DragPayload)
                );
                e.dataTransfer.effectAllowed = "move";
              }}
              className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
            >
              {open ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" />
              )}
              <Folder className="h-3.5 w-3.5 shrink-0 opacity-70" />
              <span className="truncate">{name}</span>
            </button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => ctx.onNewFile(prefix)}>
            <FilePlus className="mr-2 h-3.5 w-3.5" /> New file here
          </ContextMenuItem>
          <ContextMenuItem onClick={() => ctx.onNewFolder(prefix)}>
            <FolderPlus className="mr-2 h-3.5 w-3.5" /> New folder here
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => ctx.onRename(prefix, true)}>
            Rename
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            onClick={() => ctx.onDeleteRequest(prefix, true)}
          >
            Delete folder
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );

  return (
    <div>
      {header}
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
          {visibleFolders.map((f) => (
            <FolderNode
              key={f.key}
              prefix={f.key}
              name={f.name}
              depth={depth + 1}
              ctx={ctx}
            />
          ))}
          {data?.files.map((file) => (
            <ContextMenu key={file.key}>
              <ContextMenuTrigger>
                <div
                  className={cn(
                    "flex items-center gap-1 w-full text-sm py-1 px-2 rounded hover:bg-muted",
                    ctx.selectedKey === file.key && "bg-muted"
                  )}
                  style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
                >
                  <Checkbox
                    checked={ctx.checked.has(file.key)}
                    onCheckedChange={() => ctx.onToggleCheck(file.key)}
                    onClick={(e) => e.stopPropagation()}
                    className="h-3.5 w-3.5 shrink-0"
                    aria-label={`select ${file.name}`}
                  />
                  <button
                    onClick={() => ctx.onSelectFile(file.key)}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        DRAG_MIME,
                        JSON.stringify({
                          key: file.key,
                          isFolder: false,
                        } as DragPayload)
                      );
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
                    <span className="truncate">{file.name}</span>
                  </button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={() => downloadFile(file.key)}>
                  <Download className="mr-2 h-3.5 w-3.5" /> Download
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => ctx.onRename(file.key, false)}>
                  Rename
                </ContextMenuItem>
                <ContextMenuItem
                  variant="destructive"
                  onClick={() => ctx.onDeleteRequest(file.key, false)}
                >
                  Delete
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
          {data && visibleFolders.length === 0 && data.files.length === 0 && (
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