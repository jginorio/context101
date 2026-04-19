"use client";

import * as React from "react";
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Folder,
  FilePlus,
  FolderPlus,
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

async function fetchList(prefix: string): Promise<ListResponse> {
  const r = await fetch(`/api/files/list?prefix=${encodeURIComponent(prefix)}`);
  if (!r.ok) throw new Error(`list ${prefix} failed: ${r.status}`);
  return r.json();
}

type TreeContext = {
  selectedKey: string | null;
  refreshKey: number;
  onSelectFile: (key: string) => void;
  onNewFile: (parentPrefix: string) => void;
  onNewFolder: (parentPrefix: string) => void;
  onRename: (key: string, isFolder: boolean) => void;
  onDeleteRequest: (key: string, isFolder: boolean) => void;
};

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

  // Refetch when opened OR when the refreshKey bumps
  React.useEffect(() => {
    if (!open) return;
    setError(null);
    fetchList(prefix)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [open, prefix, ctx.refreshKey]);

  const header = depth === 0 ? null : (
    <ContextMenu>
      <ContextMenuTrigger>
        <button
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "flex items-center gap-1.5 w-full text-sm py-1 px-2 rounded hover:bg-muted text-left"
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
                <button
                  onClick={() => ctx.onSelectFile(file.key)}
                  className={cn(
                    "flex items-center gap-1.5 w-full text-sm py-1 px-2 rounded hover:bg-muted text-left",
                    ctx.selectedKey === file.key && "bg-muted"
                  )}
                  style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  <span className="truncate">{file.name}</span>
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent>
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

  const ctx: TreeContext = {
    selectedKey,
    refreshKey,
    onSelectFile,
    onNewFile,
    onNewFolder,
    onRename,
    onDeleteRequest: (key, isFolder) => setDeleteTarget({ key, isFolder }),
  };

  return (
    <>
      <div className="space-y-0.5">
        <FolderNode prefix="" name="/" depth={0} ctx={ctx} />
      </div>

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
