"use client";

import * as React from "react";
import {
  ExternalLink,
  FileText,
  LoaderCircle,
  Pencil,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import {
  TreeView,
  TreeViewBranch,
  TreeViewBranchContent,
  TreeViewBranchItem,
  TreeViewContent,
  TreeViewItem,
  TreeViewNode,
  TreeViewTree,
  createTreeCollection,
  type TreeNodeType,
} from "@/components/ui/tree-view";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  type DragPayload,
  computeMoveTarget,
  itemName,
  moveItem,
} from "@/lib/knowledge-move";
import { parentPrefixOfKey } from "@/lib/knowledge-upload";
import { useExternalFileDrop } from "@/lib/use-external-file-drop";
import {
  mergeDragProps,
  useTreeMoveDrag,
  useTreeMoveDrop,
} from "@/lib/use-tree-move";

export {
  DRAG_MIME,
  computeMoveTarget,
  type DragPayload,
} from "@/lib/knowledge-move";

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

export async function fetchList(prefix: string): Promise<ListResponse> {
  const r = await fetch(`/api/files/list?prefix=${encodeURIComponent(prefix)}`);
  if (!r.ok) throw new Error(`list ${prefix} failed: ${r.status}`);
  return r.json();
}

// ── Tree context shared between nodes ────────────────────────────────

export type TreeContext = {
  selectedKey: string | null;
  refreshKey: number;
  onSelectFile: (key: string) => void;
  // Open a file in a background tab (right-click → "Open in new tab").
  onOpenInNewTab?: (key: string) => void;
  // Connector-synced files are browse-only; the tree still supports opening
  // them in the viewer.
  mode?: "editable" | "browse";
  onRename?: (key: string, isFolder: boolean) => void;
  onDelete?: (key: string, isFolder: boolean) => void;
  // OS drag-and-drop of one or more markdown files onto a folder
  // (or onto a file, which uses that file's parent folder).
  onUploadFiles?: (parentPrefix: string, files: File[]) => void;
  // In-app drag of a library file onto a folder (or onto Uploaded Files
  // to move it to the library root). Same S3 move as rename.
  onMoved?: (from: string, to: string, isFolder: boolean) => void;
  performMove?: (src: DragPayload, destPrefix: string) => void;
};

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; data: ListResponse }
  | { status: "error"; message: string };

type KnowledgeTreeNode = Omit<TreeNodeType, "children"> & {
  children?: KnowledgeTreeNode[];
  headerIcon?: React.ReactNode;
  key: string;
  kind: "folder" | "file" | "status";
  status?: "loading" | "error" | "empty";
};

function statusNode(
  parentPrefix: string,
  status: NonNullable<KnowledgeTreeNode["status"]>,
  name: string
): KnowledgeTreeNode {
  return {
    id: `${parentPrefix || "ROOT"}::__${status}`,
    key: parentPrefix,
    kind: "status",
    name,
    status,
  };
}

const LoadingIcon = () => <LoaderCircle className="animate-spin" />;

function dropHighlight(active: boolean) {
  return active
    ? "bg-accent text-foreground ring-1 ring-inset ring-primary/40"
    : undefined;
}

function TreeNode({
  node,
  indexPath,
  ctx,
}: {
  node: KnowledgeTreeNode;
  indexPath: number[];
  ctx: TreeContext;
}) {
  const destPrefix =
    node.kind === "folder"
      ? node.key
      : node.kind === "file"
        ? parentPrefixOfKey(node.key)
        : null;
  const canUpload =
    ctx.mode === "editable" && !!ctx.onUploadFiles && destPrefix !== null;
  const canReceiveMove =
    ctx.mode === "editable" && !!ctx.performMove && destPrefix !== null;
  const canDragFile =
    ctx.mode === "editable" && !!ctx.performMove && node.kind === "file";
  const dragPayload = React.useMemo<DragPayload>(
    () => ({ key: node.key, isFolder: node.kind === "folder" }),
    [node.key, node.kind]
  );

  const drop = useExternalFileDrop(canUpload, (files) => {
    if (destPrefix === null) return;
    ctx.onUploadFiles?.(destPrefix, files);
  });
  const moveDrop = useTreeMoveDrop(canReceiveMove, destPrefix ?? "", (src) => {
    if (destPrefix === null) return;
    ctx.performMove?.(src, destPrefix);
  });
  const moveDrag = useTreeMoveDrag(canDragFile, dragPayload);
  const rowDragProps = mergeDragProps(
    drop.handlers,
    moveDrop.handlers,
    canDragFile ? moveDrag.props : null
  );
  const highlighted = dropHighlight(drop.active || moveDrop.active);

  if (node.kind === "folder") {
    const label = node.headerIcon ? (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 opacity-90">{node.headerIcon}</span>
        <span className="truncate">{node.name}</span>
      </span>
    ) : (
      node.name
    );

    // The virtual "Uploaded Files" root (empty prefix) is not a real S3
    // folder — skip rename/delete so we don't wipe the whole library.
    const canMutate =
      ctx.mode === "editable" && node.key !== "" && !!(ctx.onRename || ctx.onDelete);

    const branchItem = (
      <TreeViewBranchItem
        icon={node.headerIcon ? null : undefined}
        className={highlighted}
        data-drop-prefix={canUpload || canReceiveMove ? node.key : undefined}
        data-tree-key={node.key}
        {...rowDragProps}
      >
        {label}
      </TreeViewBranchItem>
    );

    return (
      <TreeViewNode indexPath={indexPath} node={node}>
        <TreeViewBranch>
          {canMutate ? (
            <ContextMenu>
              <ContextMenuTrigger className="contents">
                {branchItem}
              </ContextMenuTrigger>
              <ContextMenuContent>
                {ctx.onRename ? (
                  <ContextMenuItem onClick={() => ctx.onRename?.(node.key, true)}>
                    <Pencil /> Rename
                  </ContextMenuItem>
                ) : null}
                {ctx.onDelete ? (
                  <ContextMenuItem
                    variant="destructive"
                    onClick={() => ctx.onDelete?.(node.key, true)}
                  >
                    <Trash2 /> Delete
                  </ContextMenuItem>
                ) : null}
              </ContextMenuContent>
            </ContextMenu>
          ) : (
            branchItem
          )}
          <TreeViewBranchContent>
            {node.children?.map((child, index) => (
              <TreeNode
                indexPath={[...indexPath, index]}
                key={child.id}
                node={child}
                ctx={ctx}
              />
            ))}
          </TreeViewBranchContent>
        </TreeViewBranch>
      </TreeViewNode>
    );
  }

  const disabled = node.kind === "status";
  const icon =
    node.status === "loading"
      ? LoadingIcon
      : node.status === "error"
        ? TriangleAlert
        : FileText;

  const row = (
    <TreeViewNode indexPath={indexPath} node={node}>
      <TreeViewContent
        className={cn(
          disabled && "pointer-events-none italic text-muted-foreground",
          node.status === "error" && "text-destructive",
          highlighted,
          canDragFile && "cursor-grab",
          moveDrag.dragging && "opacity-60"
        )}
        data-drop-prefix={
          canUpload || canReceiveMove ? destPrefix ?? undefined : undefined
        }
        data-tree-key={node.kind === "file" ? node.key : undefined}
        aria-grabbed={moveDrag.dragging || undefined}
        {...(disabled ? {} : rowDragProps)}
      >
        <TreeViewItem icon={icon}>{node.name}</TreeViewItem>
      </TreeViewContent>
    </TreeViewNode>
  );

  // Files get a right-click menu (Open / Open in new tab, plus rename
  // and delete when the tree is editable). Status/loading rows don't.
  if (node.kind !== "file") return row;

  const canMutate =
    ctx.mode === "editable" && !!(ctx.onRename || ctx.onDelete);

  return (
    <ContextMenu>
      <ContextMenuTrigger>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => ctx.onSelectFile(node.key)}>
          <FileText /> Open
        </ContextMenuItem>
        {ctx.onOpenInNewTab ? (
          <ContextMenuItem onClick={() => ctx.onOpenInNewTab?.(node.key)}>
            <ExternalLink /> Open in new tab
          </ContextMenuItem>
        ) : null}
        {canMutate ? (
          <>
            <ContextMenuSeparator />
            {ctx.onRename ? (
              <ContextMenuItem onClick={() => ctx.onRename?.(node.key, false)}>
                <Pencil /> Rename
              </ContextMenuItem>
            ) : null}
            {ctx.onDelete ? (
              <ContextMenuItem
                variant="destructive"
                onClick={() => ctx.onDelete?.(node.key, false)}
              >
                <Trash2 /> Delete
              </ContextMenuItem>
            ) : null}
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function FolderNode({
  prefix,
  name,
  depth,
  ctx,
  hideRootFolders,
  forceHeader = false,
  headerIcon,
  defaultOpen,
  hideWhenEmpty = false,
  prefetch = false,
}: {
  prefix: string;
  name: string;
  depth: number;
  ctx: TreeContext;
  // Folder names to hide at depth 0 only (used to keep connector-managed
  // `sources/` and generated `wiki/` out of the uploaded files section).
  hideRootFolders?: string[];
  // Show a collapsible row even at depth 0 (used for connector type roots).
  forceHeader?: boolean;
  headerIcon?: React.ReactNode;
  defaultOpen?: boolean;
  // Hide connector roots that finished loading with no children.
  hideWhenEmpty?: boolean;
  // Load listing even while collapsed (needed to hide empty connector roots).
  prefetch?: boolean;
}) {
  const showRoot = depth > 0 || forceHeader;
  const initialExpanded = React.useMemo(
    () => (showRoot && defaultOpen ? [prefix] : []),
    [defaultOpen, prefix, showRoot]
  );
  const requestVersion = React.useRef(0);
  const listingsRef = React.useRef<Record<string, LoadState>>({});
  const movingRef = React.useRef(false);
  const [expanded, setExpanded] = React.useState<string[]>(initialExpanded);
  const [listings, setListings] = React.useState<Record<string, LoadState>>({});

  const setListingState = React.useCallback(
    (targetPrefix: string, state: LoadState) => {
      const next = { ...listingsRef.current, [targetPrefix]: state };
      listingsRef.current = next;
      setListings(next);
    },
    []
  );

  const loadPrefix = React.useCallback(async (targetPrefix: string) => {
    const current = listingsRef.current[targetPrefix];
    if (current?.status === "loading" || current?.status === "loaded") return;

    const version = requestVersion.current;
    setListingState(targetPrefix, { status: "loading" });

    try {
      const data = await fetchList(targetPrefix);
      if (requestVersion.current !== version) return;
      setListingState(targetPrefix, { status: "loaded", data });
    } catch (error) {
      if (requestVersion.current !== version) return;
      setListingState(targetPrefix, {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [setListingState]);

  const expandDest = React.useCallback((parentPrefix: string) => {
    if (!parentPrefix) return;
    setExpanded((prev) =>
      prev.includes(parentPrefix) ? prev : [...prev, parentPrefix]
    );
  }, []);

  const runMove = React.useCallback(
    async (src: DragPayload, destPrefix: string) => {
      const to = computeMoveTarget(src, destPrefix);
      if (!to || movingRef.current) return;
      movingRef.current = true;
      try {
        await loadPrefix(destPrefix);
        const state = listingsRef.current[destPrefix];
        if (state?.status === "loaded") {
          const name = itemName(src.key, src.isFolder);
          const clash = src.isFolder
            ? state.data.folders.some((folder) => folder.name === name)
            : state.data.files.some((file) => file.name === name);
          if (clash) {
            toast.error(`${name} already exists there`);
            return;
          }
        }
        await moveItem(src.key, to);
        toast.success(`Moved ${itemName(src.key, src.isFolder)}`);
        expandDest(destPrefix);
        ctx.onMoved?.(src.key, to, src.isFolder);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        movingRef.current = false;
      }
    },
    [ctx, expandDest, loadPrefix]
  );

  const treeCtx = React.useMemo<TreeContext>(() => {
    if (!ctx.onUploadFiles && !ctx.onMoved) return ctx;
    return {
      ...ctx,
      onUploadFiles: ctx.onUploadFiles
        ? (parentPrefix, files) => {
            expandDest(parentPrefix);
            ctx.onUploadFiles?.(parentPrefix, files);
          }
        : undefined,
      performMove: ctx.onMoved
        ? (src, destPrefix) => {
            void runMove(src, destPrefix);
          }
        : undefined,
    };
  }, [ctx, expandDest, runMove]);

  React.useEffect(() => {
    requestVersion.current += 1;
    listingsRef.current = {};
    setListings({});
    // Keep folders the user already opened so a drop-refresh doesn't
    // collapse the destination.
    setExpanded((prev) => [...new Set([...initialExpanded, ...prev])]);
  }, [ctx.refreshKey, initialExpanded]);

  React.useEffect(() => {
    if (!showRoot || prefetch || defaultOpen) {
      void loadPrefix(prefix);
    }
    for (const id of expanded) {
      void loadPrefix(id);
    }
  }, [defaultOpen, expanded, loadPrefix, prefix, prefetch, showRoot, ctx.refreshKey]);

  function buildChildren(parentPrefix: string): KnowledgeTreeNode[] {
    const state = listings[parentPrefix];
    if (!state || state.status === "loading") {
      return [statusNode(parentPrefix, "loading", "Loading...")];
    }

    if (state.status === "error") {
      return [statusNode(parentPrefix, "error", state.message)];
    }

    const visibleFolders = state.data.folders.filter(
      (folder) =>
        !(parentPrefix === prefix && hideRootFolders?.includes(folder.name))
    );

    const children: KnowledgeTreeNode[] = [
      ...visibleFolders.map((folder) => ({
        children: buildChildren(folder.key),
        id: folder.key,
        key: folder.key,
        kind: "folder" as const,
        name: folder.name,
      })),
      ...state.data.files.map((file) => ({
        id: file.key,
        key: file.key,
        kind: "file" as const,
        name: file.name,
      })),
    ];

    return children.length > 0
      ? children
      : [
          statusNode(
            parentPrefix,
            "empty",
            ctx.mode === "browse" ? "No synced files" : "empty"
          ),
        ];
  }

  const rootChildren = buildChildren(prefix);
  const rootState = listings[prefix];
  const loadedRootChildren =
    rootState?.status === "loaded"
      ? rootChildren.filter((child) => child.kind !== "status")
      : rootChildren;

  if (
    hideWhenEmpty &&
    rootState?.status === "loaded" &&
    loadedRootChildren.length === 0
  ) {
    return null;
  }

  const rootNode: KnowledgeTreeNode = {
    children: showRoot
      ? [
          {
            children: rootChildren,
            headerIcon,
            id: prefix,
            key: prefix,
            kind: "folder",
            name,
          },
        ]
      : rootChildren,
    id: "ROOT",
    key: prefix,
    kind: "folder",
    name: "",
  };

  const collection = createTreeCollection<KnowledgeTreeNode>({ rootNode });
  const nodeById = new Map<string, KnowledgeTreeNode>();
  const indexNodes = (nodes: KnowledgeTreeNode[]) => {
    for (const node of nodes) {
      nodeById.set(node.id, node);
      if (node.children) indexNodes(node.children);
    }
  };
  indexNodes(rootNode.children ?? []);

  const selectedValue = ctx.selectedKey ? [ctx.selectedKey] : [];

  return (
    <TreeView
      collection={collection}
      expandedValue={expanded}
      onExpandedChange={({ expandedValue }) => {
        setExpanded(expandedValue);
        for (const value of expandedValue) {
          const node = nodeById.get(value);
          if (node?.kind === "folder") void loadPrefix(node.key);
        }
      }}
      onSelectionChange={({ selectedValue }) => {
        const selected = selectedValue.at(-1);
        const node = selected ? nodeById.get(selected) : undefined;
        if (node?.kind === "file") ctx.onSelectFile(node.key);
      }}
      selectedValue={selectedValue}
      className="[--icon-size:--spacing(3.5)] [--indentation:--spacing(3)] gap-0"
    >
      <TreeViewTree className="text-sm">
        {rootNode.children?.map((node, index) => (
          <TreeNode indexPath={[index]} key={node.id} node={node} ctx={treeCtx} />
        ))}
      </TreeViewTree>
    </TreeView>
  );
}