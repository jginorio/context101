"use client";

import * as React from "react";
import Link from "next/link";
import {
  ChevronRight,
  FilePlus,
  FolderClosed,
  FolderPlus,
  MoreHorizontal,
  Plus,
} from "lucide-react";

import {
  FolderNode,
  fetchList,
  type TreeContext,
} from "@/components/knowledge-tree";
import { NotionSource } from "@/components/notion-tree";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  HIDDEN_ROOT_FOLDERS,
  hasVisibleLibraryEntries,
} from "@/lib/knowledge-library";
import {
  visibleConnectorTypes,
  visibleProviderGroups,
} from "@/lib/knowledge-sources";
import { GoogleLogo } from "@/components/source-logos";
import {
  SOURCE_TYPES,
  TypeIcon,
  type ConnectorType,
} from "@/lib/source-providers";
import { useAppShell } from "@/components/app-shell";
import type { Connector } from "@/utils/connectors";
import { cn } from "@/lib/utils";

// A muted group label with an optional hover-revealed action, matching the
// clean "Overview / Projects / Team" grouping in dashboard-style sidebars.
function GroupHeader({
  label,
  action,
}: {
  label: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="group/hdr flex items-center justify-between gap-1 px-2 pt-1 pb-0.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {label}
      </span>
      {action ? (
        <span className="opacity-0 transition-opacity group-hover/hdr:opacity-100">
          {action}
        </span>
      ) : null}
    </div>
  );
}

// Placeholder rows sized like collapsed connector rows, shown until we know
// which connectors exist — rendering the real names first would flash sources
// the brain isn't connected to.
function SourceRowsSkeleton() {
  return (
    <div aria-hidden>
      {["w-24", "w-28", "w-20"].map((width) => (
        <div key={width} className="my-px flex min-h-8 items-center px-3">
          <Skeleton className={cn("h-3.5 rounded-sm", width)} />
        </div>
      ))}
    </div>
  );
}

function SourceTypeTree({
  type,
  ctx,
  name,
}: {
  type: ConnectorType;
  ctx: TreeContext;
  name?: string;
}) {
  return (
    <FolderNode
      prefix={SOURCE_TYPES[type].prefix}
      name={name ?? SOURCE_TYPES[type].menuLabel}
      depth={0}
      ctx={ctx}
      forceHeader
      defaultOpen={false}
      headerIcon={
        <TypeIcon type={type} className="h-3.5 w-3.5 shrink-0 opacity-90" />
      }
    />
  );
}

function GoogleSourceGroup({
  types,
  ctx,
}: {
  types: ConnectorType[];
  ctx: TreeContext;
}) {
  const [open, setOpen] = React.useState(true);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-label="Google"
        onClick={() => setOpen((prev) => !prev)}
        className="my-px flex min-h-8 w-full items-center gap-1.5 rounded-md px-3 py-1.5 text-start text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform",
            open && "rotate-90"
          )}
        />
        <GoogleLogo className="h-3.5 w-3.5 shrink-0 opacity-90" />
        <span className="truncate">Google</span>
      </button>
      {open
        ? types.map((type) => (
            <div key={type} className="ps-3">
              <SourceTypeTree
                type={type}
                ctx={ctx}
                name={SOURCE_TYPES[type].label}
              />
            </div>
          ))
        : null}
    </div>
  );
}

export function KnowledgeSidebar({
  selectedKey,
  refreshKey,
  onSelectFile,
  onOpenInNewTab,
  onNewFile,
  onNewFolder,
  onDelete,
  onMoved,
  onAddSource,
  onUploadFiles,
}: {
  selectedKey: string | null;
  refreshKey: number;
  onSelectFile: (key: string) => void;
  onOpenInNewTab?: (key: string) => void;
  onNewFile: (parentPrefix: string) => void;
  onNewFolder: (parentPrefix: string) => void;
  onDelete?: (key: string, isFolder: boolean) => void;
  onMoved?: (from: string, to: string, isFolder: boolean) => void;
  onAddSource?: () => void;
  onUploadFiles?: (parentPrefix: string, files: File[]) => void;
}) {
  const { closeMobileNav } = useAppShell();
  // Both stay `null` until the first load resolves. Refreshes keep the
  // previous values so the section doesn't collapse back to skeletons on
  // every upload.
  const [connectors, setConnectors] = React.useState<Connector[] | null>(null);
  // Folders directly under `sources/` (docs, github, …). Combined with
  // connector item_count so a synced Google Doc still appears when the
  // parent listing omits `docs/`.
  const [sourceFolders, setSourceFolders] = React.useState<string[] | null>(
    null
  );
  // Uploaded Files is just another source — hide the Library section until
  // there is at least one user file or folder. Stay `null` on first load so
  // we don't flash an empty tree.
  const [libraryHasFiles, setLibraryHasFiles] = React.useState<boolean | null>(
    null
  );

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/connectors/list")
      .then((r) => r.json())
      .then((j) => !cancelled && setConnectors(j.items ?? []))
      .catch(() => !cancelled && setConnectors([]));
    fetchList("sources/")
      .then(
        (d) => !cancelled && setSourceFolders(d.folders.map((f) => f.name))
      )
      .catch(() => !cancelled && setSourceFolders([]));
    fetchList("")
      .then(
        (d) => !cancelled && setLibraryHasFiles(hasVisibleLibraryEntries(d))
      )
      .catch(() => !cancelled && setLibraryHasFiles(false));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const notionTrees = React.useMemo(
    () =>
      (connectors ?? []).flatMap((c) =>
        c.type === "notion" && c.notion_tree ? [c.notion_tree] : []
      ),
    [connectors]
  );

  const sourcesLoading = connectors === null || sourceFolders === null;
  const visibleTypes = React.useMemo(
    () =>
      visibleConnectorTypes({
        sourceFolders: sourceFolders ?? [],
        connectors,
      }),
    [connectors, sourceFolders]
  );
  const sourceGroups = React.useMemo(
    () => visibleProviderGroups(visibleTypes),
    [visibleTypes]
  );

  const openAddSource = () => {
    closeMobileNav(() => onAddSource?.());
  };

  const editableCtx: TreeContext = {
    selectedKey,
    refreshKey,
    onSelectFile: (key) => {
      onSelectFile(key);
      closeMobileNav();
    },
    onOpenInNewTab,
    mode: "editable",
    onDelete,
    onMoved,
    onUploadFiles,
  };

  const browseCtx: TreeContext = {
    selectedKey,
    refreshKey,
    onSelectFile: (key) => {
      onSelectFile(key);
      closeMobileNav();
    },
    onOpenInNewTab,
    mode: "browse",
  };

  return (
    <div className="space-y-3">
      {/* Library — only when uploaded files exist. An empty tree is the
          same as an unconnected source: add files from Add source. */}
      {libraryHasFiles ? (
        <div className="space-y-0.5">
          <GroupHeader
            label="Library"
            action={
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="h-5 w-5 shrink-0"
                      aria-label="Uploaded files actions"
                    />
                  }
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => closeMobileNav(() => onNewFile(""))}
                  >
                    <FilePlus className="mr-2 h-3.5 w-3.5" /> New file
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => closeMobileNav(() => onNewFolder(""))}
                  >
                    <FolderPlus className="mr-2 h-3.5 w-3.5" /> New folder
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
          <FolderNode
            prefix=""
            name="Uploaded Files"
            depth={0}
            ctx={editableCtx}
            hideRootFolders={[...HIDDEN_ROOT_FOLDERS]}
            forceHeader
            defaultOpen
            headerIcon={
              <FolderClosed className="h-3.5 w-3.5 shrink-0 opacity-90" />
            }
          />
        </div>
      ) : null}

      {/* Sources — each connector as an expandable item (Notion gets the
          Notion-style tree). */}
      <div className="space-y-0.5">
        <GroupHeader label="Sources" />
        {sourcesLoading ? (
          <SourceRowsSkeleton />
        ) : (
          sourceGroups.map((group) => {
            if (group.id === "google") {
              return (
                <GoogleSourceGroup
                  key="google"
                  types={group.types}
                  ctx={browseCtx}
                />
              );
            }
            if (group.id === "notion") {
              return (
                <NotionSource
                  key="notion"
                  trees={notionTrees}
                  selectedKey={selectedKey}
                  onSelectFile={(key) => {
                    onSelectFile(key);
                    closeMobileNav();
                  }}
                  onOpenInNewTab={onOpenInNewTab}
                />
              );
            }
            return (
              <React.Fragment key={group.id}>
                {group.types.map((type) => (
                  <SourceTypeTree key={type} type={type} ctx={browseCtx} />
                ))}
              </React.Fragment>
            );
          })
        )}
        <p className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
          Manage connectors on the{" "}
          <Link
            href="/sources"
            onClick={() => closeMobileNav()}
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            Sources
          </Link>{" "}
          page.
        </p>
        {onAddSource ? (
          <Button
            variant="outline"
            size="sm"
            onClick={openAddSource}
            className="w-full justify-center"
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add source
          </Button>
        ) : null}
      </div>
    </div>
  );
}
