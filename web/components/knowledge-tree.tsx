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
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
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
const DRAG_MIME = "application/x-context101";
type DragPayload = { key: string; isFolder: boolean };

async function fetchList(prefix: string): Promise<ListResponse> {
  const r = await fetch(`/api/files/list?prefix=${encodeURIComponent(prefix)}`);
  if (!r.ok) throw new Error(`list ${prefix} failed: ${r.status}`);
  return r.json();
}

async function moveItem(from: string, to: string): Promise<void> {
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

type TreeContext = {
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
function computeMoveTarget(
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

function FolderNode({
  prefix,
  name,
  depth,
  ctx,
}: {
  prefix: string;
  name: string;
  depth: number;
  ctx: TreeContext;
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
          {data?.folders.map((f) => (
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

// ── Root ─────────────────────────────────────────────────────────────

export function KnowledgeTree({
  selectedKey,
  refreshKey,
  onSelectFile,
  onNewFile,
  onNewFolder,
  onRename,
  onDeleted,
}: {
  selectedKey: string | null;
  refreshKey: number;
  onSelectFile: (key: string) => void;
  onNewFile: (parentPrefix: string) => void;
  onNewFolder: (parentPrefix: string) => void;
  onRename: (key: string, isFolder: boolean) => void;
  onDeleted: (key: string, isFolder: boolean) => void;
}) {
  const [deleteTarget, setDeleteTarget] = React.useState<{
    key: string;
    isFolder: boolean;
  } | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [rootDragOver, setRootDragOver] = React.useState(false);
  const [localRefresh, setLocalRefresh] = React.useState(0);

  // Multi-select for zip export. Keys follow S3 convention — folders
  // end with "/", files don't. The /api/files/zip route expands folder
  // prefixes on the server.
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [zipping, setZipping] = React.useState(false);

  const toggleCheck = React.useCallback((key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  async function downloadZip() {
    if (checked.size === 0) return;
    setZipping(true);
    try {
      const res = await fetch("/api/files/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: [...checked] }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(j.error ?? `zip failed: ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `context101-export-${stamp}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${checked.size} item(s)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setZipping(false);
    }
  }

  // When the parent bumps refreshKey, or we need to refresh internally
  // (e.g. after a drag-and-drop move), we merge them here.
  const mergedRefreshKey = refreshKey + localRefresh;

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/files/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: deleteTarget.key,
          recursive: deleteTarget.isFolder,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "delete failed");
      toast.success(
        deleteTarget.isFolder
          ? `Deleted folder (${j.deleted} files)`
          : "Deleted"
      );
      const target = deleteTarget;
      setDeleteTarget(null);
      onDeleted(target.key, target.isFolder);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  // Root drop = move to root (prefix "")
  const handleRootDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setRootDragOver(true);
  };
  const handleRootDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setRootDragOver(false);
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    let payload: DragPayload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    const to = computeMoveTarget(payload, "");
    if (!to) return;
    try {
      await moveItem(payload.key, to);
      toast.success("Moved to /");
      setLocalRefresh((n) => n + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const ctx: TreeContext = {
    selectedKey,
    refreshKey: mergedRefreshKey,
    onSelectFile,
    onNewFile,
    onNewFolder,
    onRename,
    onDeleteRequest: (key, isFolder) => setDeleteTarget({ key, isFolder }),
    onMoved: () => setLocalRefresh((n) => n + 1),
    checked,
    onToggleCheck: toggleCheck,
  };

  return (
    <>
      {checked.size > 0 && (
        <div className="sticky top-0 z-10 mb-1 flex items-center justify-between gap-2 rounded-md border bg-background/95 backdrop-blur px-2 py-1.5">
          <span className="text-xs text-muted-foreground">
            {checked.size} selected
          </span>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setChecked(new Set())}
              disabled={zipping}
            >
              Clear
            </Button>
            <Button size="sm" onClick={downloadZip} disabled={zipping}>
              <Download className="mr-1 h-3.5 w-3.5" />
              {zipping ? "Zipping…" : "Download ZIP"}
            </Button>
          </div>
        </div>
      )}
      <ContextMenu>
        <ContextMenuTrigger>
          <div
            onDragOver={handleRootDragOver}
            onDragLeave={() => setRootDragOver(false)}
            onDrop={handleRootDrop}
            className={cn(
              "space-y-0.5 min-h-full rounded",
              rootDragOver && "bg-accent/40 ring-1 ring-ring"
            )}
          >
            <FolderNode prefix="" name="/" depth={0} ctx={ctx} />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onNewFile("")}>
            <FilePlus className="mr-2 h-3.5 w-3.5" /> New file at root
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onNewFolder("")}>
            <FolderPlus className="mr-2 h-3.5 w-3.5" /> New folder at root
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteTarget?.isFolder ? "folder" : "file"}?
            </AlertDialogTitle>
            <AlertDialogDescription className="font-mono text-xs break-all">
              {deleteTarget?.key}
              {deleteTarget?.isFolder && (
                <span className="block mt-2 font-sans text-sm">
                  Everything under this folder will be deleted. This can&apos;t be
                  undone.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
