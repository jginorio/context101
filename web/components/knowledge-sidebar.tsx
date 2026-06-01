"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FilePlus,
  FolderPlus,
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { AddSourceDialog } from "@/components/add-source-dialog";
import {
  PROVIDER_GROUPS,
  SOURCE_TYPES,
  TypeIcon,
  type ConnectorType,
  type ProviderGroup,
} from "@/lib/source-providers";
import { useAppShell } from "@/components/app-shell";
import { cn } from "@/lib/utils";

// Root folders that are surfaced through their own grouped sections, so we
// keep them out of the "Your files" tree.
const HIDDEN_ROOT_FOLDERS = ["sources", "wiki"];

function SectionHeader({
  label,
  icon,
  collapsed,
  onToggle,
  action,
}: {
  label: string;
  icon?: React.ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onToggle}
        className="flex flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0" />
        )}
        {icon}
        <span className="truncate">{label}</span>
      </button>
      {action}
    </div>
  );
}

// Renders a connector type's S3 prefix as a lazily-loaded subtree. Empty
// state nudges the user to add a source.
function ProviderSubtree({
  type,
  ctx,
}: {
  type: ConnectorType;
  ctx: TreeContext;
}) {
  return (
    <div className="ml-1 border-l pl-1">
      <FolderNode
        prefix={SOURCE_TYPES[type].prefix}
        name={SOURCE_TYPES[type].label}
        depth={0}
        ctx={ctx}
      />
    </div>
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

  // Multi-select for zip export, scoped to the user's own files. Keys follow
  // the S3 convention — folders end with "/", files don't.
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [zipping, setZipping] = React.useState(false);

  // Expanded state per section id; absent = collapsed (all sections start
  // collapsed so the sidebar opens compact).
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const toggleSection = (id: string) =>
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

  // Select every manual file/folder at the root (connector-managed and
  // generated prefixes are excluded — they're browsed, not bulk-exported).
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

  // Merge the parent's refresh signal with internal ones (e.g. after a move).
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

  // Dropping onto the "Your files" area moves the item to the root prefix.
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
  };

  const addButton = (onClick: () => void, label: string) => (
    <Button
      size="icon-sm"
      variant="ghost"
      className="h-5 w-5"
      onClick={onClick}
      aria-label={label}
    >
      <Plus className="h-3.5 w-3.5" />
    </Button>
  );

  function ProviderAddAction(group: ProviderGroup) {
    if (group.types.length === 1) {
      return addButton(
        () => setAddType(group.types[0]),
        `Add ${group.label} source`
      );
    }
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              className="h-5 w-5"
              aria-label={`Add ${group.label} source`}
            />
          }
        >
          <Plus className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {group.types.map((t) => (
            <DropdownMenuItem key={t} onClick={() => setAddType(t)}>
              <TypeIcon type={t} className="mr-2 h-3.5 w-3.5" />
              {SOURCE_TYPES[t].menuLabel}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Your files ─────────────────────────────────────────────── */}
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <SectionHeader
            label="Your files"
            collapsed={!expanded["your-files"]}
            onToggle={() => toggleSection("your-files")}
          />
          {checked.size === 0 ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 shrink-0 text-xs"
              onClick={selectAll}
            >
              Select all
            </Button>
          ) : (
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-xs"
                onClick={() => setChecked(new Set())}
                disabled={zipping}
              >
                Clear
              </Button>
              <Button
                size="sm"
                className="h-6 text-xs"
                onClick={downloadZip}
                disabled={zipping}
              >
                <Download className="mr-1 h-3.5 w-3.5" />
                {zipping ? "Zipping…" : "ZIP"}
              </Button>
            </div>
          )}
        </div>

        {expanded["your-files"] && (
          <ContextMenu>
            <ContextMenuTrigger>
              <div
                onDragOver={handleRootDragOver}
                onDragLeave={() => setRootDragOver(false)}
                onDrop={handleRootDrop}
                className={cn(
                  "min-h-8 space-y-0.5 rounded",
                  rootDragOver && "bg-accent/40 ring-1 ring-ring"
                )}
              >
                <FolderNode
                  prefix=""
                  name="/"
                  depth={0}
                  ctx={ctx}
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
        )}
      </div>

      {/* ── Connected sources, grouped by provider ─────────────────── */}
      {PROVIDER_GROUPS.map((group) => {
        const GroupIcon = group.icon;
        const isCollapsed = !expanded[group.id];
        return (
          <div key={group.id}>
            <SectionHeader
              label={group.label}
              icon={<GroupIcon className="h-3 w-3 shrink-0" />}
              collapsed={isCollapsed}
              onToggle={() => toggleSection(group.id)}
              action={ProviderAddAction(group)}
            />
            {!isCollapsed && (
              <div className="mt-0.5">
                {group.types.length === 1 ? (
                  <ProviderSubtree type={group.types[0]} ctx={ctx} />
                ) : (
                  group.types.map((t) => {
                    const childId = `${group.id}:${t}`;
                    const childCollapsed = !expanded[childId];
                    return (
                      <div key={t} className="ml-1">
                        <SectionHeader
                          label={SOURCE_TYPES[t].label}
                          icon={<TypeIcon type={t} className="h-3 w-3 shrink-0" />}
                          collapsed={childCollapsed}
                          onToggle={() => toggleSection(childId)}
                        />
                        {!childCollapsed && (
                          <ProviderSubtree type={t} ctx={ctx} />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}

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
