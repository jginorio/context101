"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  LoaderCircle,
} from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { TypeIcon } from "@/lib/source-providers";
import type { NotionTreeNode } from "@/utils/connectors";
import { cn } from "@/lib/utils";

function NodeIcon({ icon }: { icon: NotionTreeNode["icon"] }) {
  if (icon?.type === "emoji") {
    return (
      <span className="grid h-4 w-4 shrink-0 place-items-center text-[13px] leading-none">
        {icon.value}
      </span>
    );
  }
  if (icon?.type === "url") {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={icon.value}
        alt=""
        className="h-4 w-4 shrink-0 rounded-[3px] object-cover"
      />
    );
  }
  return <FileText className="h-3.5 w-3.5 shrink-0 opacity-60" />;
}

function NotionNode({
  node,
  depth,
  selectedKey,
  onSelect,
  onOpenInNewTab,
}: {
  node: NotionTreeNode;
  depth: number;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onOpenInNewTab?: (key: string) => void;
}) {
  // Roots and their direct children start expanded so a connected page reads
  // like Notion the moment you open the sidebar.
  const [open, setOpen] = React.useState(depth < 1);
  const hasChildren = node.children && node.children.length > 0;
  const selected = !!node.key && node.key === selectedKey;

  const row = (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-expanded={hasChildren ? open : undefined}
      title={node.title}
      onClick={() => {
        if (node.key) onSelect(node.key);
        else if (hasChildren) setOpen((o) => !o);
      }}
      className={cn(
        "group flex cursor-pointer items-center gap-1 rounded-md py-1 pr-2 pl-1 text-sm transition-colors hover:bg-muted/60",
        selected && "bg-muted text-foreground"
      )}
    >
      {hasChildren ? (
        <button
          type="button"
          aria-label={open ? "Collapse" : "Expand"}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          className="grid h-4 w-4 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
      ) : (
        <span className="h-4 w-4 shrink-0" />
      )}
      <NodeIcon icon={node.icon} />
      <span className="truncate">{node.title}</span>
    </div>
  );

  return (
    <div>
      {node.key && onOpenInNewTab ? (
        <ContextMenu>
          <ContextMenuTrigger>{row}</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => onSelect(node.key!)}>
              <FileText /> Open
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onOpenInNewTab(node.key!)}>
              <ExternalLink /> Open in new tab
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        row
      )}
      {hasChildren && open ? (
        // Indent children with a subtle vertical guide line (Notion-style).
        <div className="ml-[15px] border-l border-sidebar-border/70 pl-1.5">
          {node.children.map((child) => (
            <NotionNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedKey={selectedKey}
              onSelect={onSelect}
              onOpenInNewTab={onOpenInNewTab}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Notion-style source group: renders each connected Notion page as an
 * expandable tree (page emojis/icons + nesting), driven by the hierarchy the
 * sync stores on the connector (`metadata.notion_tree`). Hidden until at least
 * one Notion connector has a synced tree.
 */
export function NotionSource({
  refreshKey,
  selectedKey,
  onSelectFile,
  onOpenInNewTab,
}: {
  refreshKey: number;
  selectedKey: string | null;
  onSelectFile: (key: string) => void;
  onOpenInNewTab?: (key: string) => void;
}) {
  const [trees, setTrees] = React.useState<NotionTreeNode[] | null>(null);
  const [open, setOpen] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setTrees(null);
    fetch("/api/connectors/list")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const items: { type: string; notion_tree?: NotionTreeNode }[] =
          j.items ?? [];
        setTrees(
          items
            .filter((c) => c.type === "notion" && c.notion_tree)
            .map((c) => c.notion_tree as NotionTreeNode)
        );
      })
      .catch(() => !cancelled && setTrees([]));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // Hide entirely when there are no Notion trees (matches the other connector
  // roots' hide-when-empty behavior).
  if (trees && trees.length === 0) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 rounded-md px-1 py-1 text-sm text-foreground transition-colors hover:bg-muted/60"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <TypeIcon type="notion" className="h-3.5 w-3.5 shrink-0 opacity-90" />
        <span className="truncate">Notion</span>
      </button>
      {open ? (
        trees === null ? (
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="pl-1">
            {trees.map((tree) => (
              <NotionNode
                key={tree.id}
                node={tree}
                depth={0}
                selectedKey={selectedKey}
                onSelect={onSelectFile}
                onOpenInNewTab={onOpenInNewTab}
              />
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
