"use client";

import * as React from "react";
import Link from "next/link";
import {
  FilePlus,
  FolderClosed,
  FolderPlus,
  MoreHorizontal,
  Plus,
} from "lucide-react";

import { FolderNode, type TreeContext } from "@/components/knowledge-tree";
import { NotionSource } from "@/components/notion-tree";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  CONNECTOR_TYPES,
  SOURCE_TYPES,
  TypeIcon,
} from "@/lib/source-providers";
import { useAppShell } from "@/components/app-shell";

// Root folders that are surfaced through their own grouped sections, so we
// keep them out of the uploaded files tree.
const HIDDEN_ROOT_FOLDERS = ["sources", "wiki"];

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

export function KnowledgeSidebar({
  selectedKey,
  refreshKey,
  onSelectFile,
  onOpenInNewTab,
  onNewFile,
  onNewFolder,
  onRename,
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
  onRename?: (key: string, isFolder: boolean) => void;
  onDelete?: (key: string, isFolder: boolean) => void;
  onMoved?: (from: string, to: string, isFolder: boolean) => void;
  onAddSource?: () => void;
  onUploadFiles?: (parentPrefix: string, files: File[]) => void;
}) {
  const { closeMobileNav } = useAppShell();

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
    onRename,
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
      {/* Library — uploaded files as one expandable parent */}
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
          hideRootFolders={HIDDEN_ROOT_FOLDERS}
          forceHeader
          defaultOpen
          headerIcon={
            <FolderClosed className="h-3.5 w-3.5 shrink-0 opacity-90" />
          }
        />
      </div>

      {/* Sources — each connector as an expandable item (Notion gets the
          Notion-style tree). */}
      <div className="space-y-0.5">
        <GroupHeader label="Sources" />
        {CONNECTOR_TYPES.map((type) =>
          type === "notion" ? (
            <NotionSource
              key="notion"
              refreshKey={refreshKey}
              selectedKey={selectedKey}
              onSelectFile={(key) => {
                onSelectFile(key);
                closeMobileNav();
              }}
              onOpenInNewTab={onOpenInNewTab}
            />
          ) : (
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
                <TypeIcon
                  type={type}
                  className="h-3.5 w-3.5 shrink-0 opacity-90"
                />
              }
            />
          )
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
