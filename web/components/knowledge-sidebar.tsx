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
import { AddSourceDialog } from "@/components/add-source-dialog";
import {
  CONNECTOR_TYPES,
  SOURCE_TYPES,
  TypeIcon,
  type ConnectorType,
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
}: {
  selectedKey: string | null;
  refreshKey: number;
  onSelectFile: (key: string) => void;
  onOpenInNewTab?: (key: string) => void;
  onNewFile: (parentPrefix: string) => void;
  onNewFolder: (parentPrefix: string) => void;
}) {
  const { closeMobileNav } = useAppShell();

  const [addType, setAddType] = React.useState<ConnectorType | null>(null);

  const editableCtx: TreeContext = {
    selectedKey,
    refreshKey,
    onSelectFile: (key) => {
      onSelectFile(key);
      closeMobileNav();
    },
    onOpenInNewTab,
    mode: "editable",
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
                <DropdownMenuItem onClick={() => onNewFile("")}>
                  <FilePlus className="mr-2 h-3.5 w-3.5" /> New file
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onNewFolder("")}>
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
        <GroupHeader
          label="Sources"
          action={
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="h-5 w-5 shrink-0"
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
        />
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
            onClick={closeMobileNav}
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            Sources
          </Link>{" "}
          page.
        </p>
      </div>

      <AddSourceDialog
        open={!!addType}
        onOpenChange={(v) => !v && setAddType(null)}
        type={addType ?? "docs"}
      />
    </div>
  );
}
