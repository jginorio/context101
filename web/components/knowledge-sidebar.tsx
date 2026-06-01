"use client";

import * as React from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FilePlus,
  FolderPlus,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

import {
  FolderNode,
  computeMoveTarget,
  moveItem,
  DRAG_MIME,
  type DragPayload,
  type TreeContext,
} from "@/components/knowledge-tree";
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { AddSourceDialog } from "@/components/add-source-dialog";
import {
  CONNECTOR_TYPES,
  SOURCE_TYPES,
  TypeIcon,
  type ConnectorType,
} from "@/lib/source-providers";
import { useAppShell } from "@/components/app-shell";
import { cn } from "@/lib/utils";

// Root folders that are surfaced through their own grouped sections, so we
// keep them out of the uploaded files tree.
const HIDDEN_ROOT_FOLDERS = ["sources", "wiki"];

function SidebarSection({
  label,
  collapsed,
  onToggle,
  action,
  children,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card/40">
      <div className="flex items-center gap-1 border-b border-border/60 px-1.5 py-1">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted/60"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
          )}
          <span className="truncate">{label}</span>
        </button>
        {action}
      </div>
      {!collapsed ? <div className="p-1">{children}</div> : null}
    </section>
  );
}

export function KnowledgeSidebar({
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
  const { closeMobileNav } = useAppShell();

  const [deleteTarget, setDeleteTarget] = React.useState<{
    key: string;
    isFolder: boolean;
  } | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [rootDragOver, setRootDragOver] = React.useState(false);
  const [localRefresh, setLocalRefresh] = React.useState(0);

  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [zipping, setZipping] = React.useState(false);

  const [expanded, setExpanded] = React.useState({
    "your-files": true,
    sources: true,
  });
  const toggleSection = (id: "your-files" | "sources") =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const [addType, setAddType] = React.useState<ConnectorType | null>(null);

  const toggleCheck = React.useCallback((key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  async function selectAll() {
    try {
      const r = await fetch("/api/files/list?prefix=");
      if (!r.ok) throw new Error(`list failed: ${r.status}`);
      const j = (await r.json()) as {
        folders?: { key: string; name: string }[];
        files?: { key: string }[];
      };
      const all = new Set<string>();
      for (const f of j.folders ?? []) {
        if (!HIDDEN_ROOT_FOLDERS.includes(f.name)) all.add(f.key);
      }
      for (const f of j.files ?? []) all.add(f.key);
      setChecked(all);
      if (all.size === 0) toast.info("Nothing to select");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

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

  const editableCtx: TreeContext = {
    selectedKey,
    refreshKey: mergedRefreshKey,
    onSelectFile: (key) => {
      onSelectFile(key);
      closeMobileNav();
    },
    onNewFile,
    onNewFolder,
    onRename,
    onDeleteRequest: (key, isFolder) => setDeleteTarget({ key, isFolder }),
    onMoved: () => setLocalRefresh((n) => n + 1),
    checked,
    onToggleCheck: toggleCheck,
    mode: "editable",
  };

  const browseCtx: TreeContext = {
    selectedKey,
    refreshKey: mergedRefreshKey,
    onSelectFile: (key) => {
      onSelectFile(key);
      closeMobileNav();
    },
    onNewFile: () => {},
    onNewFolder: () => {},
    onRename: () => {},
    onDeleteRequest: () => {},
    onMoved: () => {},
    checked: new Set(),
    onToggleCheck: () => {},
    mode: "browse",
  };

  return (
    <div className="space-y-2">
      <SidebarSection
        label="Uploaded files"
        collapsed={!expanded["your-files"]}
        onToggle={() => toggleSection("your-files")}
        action={
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="h-6 w-6 shrink-0"
                  aria-label="Uploaded files actions"
                />
              }
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onNewFile("")}>
                <FilePlus className="mr-2 h-3.5 w-3.5" /> New file
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onNewFolder("")}>
                <FolderPlus className="mr-2 h-3.5 w-3.5" /> New folder
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={selectAll}>Select all</DropdownMenuItem>
              {checked.size > 0 ? (
                <>
                  <DropdownMenuItem onClick={() => setChecked(new Set())}>
                    Clear selection
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={downloadZip} disabled={zipping}>
                    <Download className="mr-2 h-3.5 w-3.5" />
                    {zipping ? "Zipping…" : `Download ZIP (${checked.size})`}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        <ContextMenu>
          <ContextMenuTrigger>
            <div
              onDragOver={handleRootDragOver}
              onDragLeave={() => setRootDragOver(false)}
              onDrop={handleRootDrop}
              className={cn(
                "min-h-8 space-y-0.5 rounded-md",
                rootDragOver && "bg-accent/40 ring-1 ring-ring"
              )}
            >
              <FolderNode
                prefix=""
                name="/"
                depth={0}
                ctx={editableCtx}
                hideRootFolders={HIDDEN_ROOT_FOLDERS}
              />
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
      </SidebarSection>

      <SidebarSection
        label="Connected sources"
        collapsed={!expanded.sources}
        onToggle={() => toggleSection("sources")}
        action={
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="h-6 w-6 shrink-0"
                  aria-label="Add connected source"
                />
              }
            >
              <Plus className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {CONNECTOR_TYPES.map((t) => (
                <DropdownMenuItem key={t} onClick={() => setAddType(t)}>
                  <TypeIcon type={t} className="mr-2 h-3.5 w-3.5" />
                  {SOURCE_TYPES[t].menuLabel}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        <div className="space-y-0.5">
          {CONNECTOR_TYPES.map((type) => (
            <FolderNode
              key={type}
              prefix={SOURCE_TYPES[type].prefix}
              name={SOURCE_TYPES[type].menuLabel}
              depth={0}
              ctx={browseCtx}
              forceHeader
              prefetch
              hideWhenEmpty
              defaultOpen={false}
              headerIcon={
                <TypeIcon type={type} className="h-3.5 w-3.5 shrink-0 opacity-90" />
              }
            />
          ))}
          <p className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
            Manage connectors on the{" "}
            <Link
              href="/sources"
              onClick={closeMobileNav}
              className="font-medium text-foreground underline-offset-2 hover:underline"
            >
              Sources
            </Link>{" "}
            page.
          </p>
        </div>
      </SidebarSection>

      <AddSourceDialog
        open={!!addType}
        onOpenChange={(v) => !v && setAddType(null)}
        type={addType ?? "docs"}
      />

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
                <span className="mt-2 block font-sans text-sm">
                  Everything under this folder will be deleted. This can&apos;t
                  be undone.
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
    </div>
  );
}
