"use client";

import * as React from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  FilePlus,
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
    <section className="app-surface">
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

  const [expanded, setExpanded] = React.useState({
    "your-files": true,
    sources: true,
  });
  const toggleSection = (id: "your-files" | "sources") =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

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
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        <div className="min-h-8 rounded-md">
          <FolderNode
            prefix=""
            name="/"
            depth={0}
            ctx={editableCtx}
            hideRootFolders={HIDDEN_ROOT_FOLDERS}
          />
        </div>
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
          {CONNECTOR_TYPES.map((type) =>
            type === "notion" ? (
              // Notion gets a dedicated, Notion-style tree (page emojis +
              // nesting) built from the hierarchy the sync stores per
              // connector, instead of the flat S3 folder listing.
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
      </SidebarSection>

      <AddSourceDialog
        open={!!addType}
        onOpenChange={(v) => !v && setAddType(null)}
        type={addType ?? "docs"}
      />
    </div>
  );
}
