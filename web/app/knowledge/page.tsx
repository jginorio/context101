"use client";

import * as React from "react";
import { FilePlus, FolderPlus, Plus } from "lucide-react";

import { KnowledgeSidebar } from "@/components/knowledge-sidebar";
import { KnowledgeTabs } from "@/components/knowledge-tabs";
import { KnowledgeViewer } from "@/components/knowledge-viewer";
import { NewItemDialog } from "@/components/new-item-dialog";
import { DeleteItemDialog } from "@/components/delete-item-dialog";
import { AddSourceDialog } from "@/components/add-source-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AppShell } from "@/components/app-shell";
import { BrainStatusGate } from "@/components/brain-status-gate";
import { useBrain } from "@/lib/brain-context";
import {
  applyDeleteToKeys,
  applyRenameToKeys,
  isRemovedByDelete,
  remapKeyAfterRename,
} from "@/lib/knowledge-keys";
import {
  describeUploadResult,
  uploadMarkdownFiles,
} from "@/lib/knowledge-upload";
import { toast } from "sonner";

export default function Home() {
  const { currentBrainId } = useBrain();
  const [openTabs, setOpenTabs] = React.useState<string[]>([]);
  const [activeKey, setActiveKey] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  // Open (or focus) a document tab. `focus: false` opens in the background
  // (used by "open in new tab" / deep-links that shouldn't steal focus).
  const openTab = React.useCallback((key: string, focus = true) => {
    setOpenTabs((prev) => (prev.includes(key) ? prev : [...prev, key]));
    if (focus) setActiveKey(key);
  }, []);

  const closeTab = React.useCallback((key: string) => {
    setOpenTabs((prev) => {
      const idx = prev.indexOf(key);
      if (idx === -1) return prev;
      const next = prev.filter((k) => k !== key);
      setActiveKey((cur) => {
        if (cur !== key) return cur;
        if (next.length === 0) return null;
        // Activate the neighbor that takes this tab's slot.
        return next[Math.min(idx, next.length - 1)];
      });
      return next;
    });
  }, []);

  // Switching brain → close all tabs (they live in the previous brain's
  // bucket) and bump the tree refresh key so it re-fetches against the new
  // brain. The cookie/URL update happens in `setBrain` inside BrainProvider.
  React.useEffect(() => {
    setOpenTabs([]);
    setActiveKey(null);
    setRefreshKey((k) => k + 1);
  }, [currentBrainId]);

  // Deep-link support: /knowledge?open=<key>[,<key>...] opens those docs as
  // tabs (used by wiki "Sources:" citations linking to knowledge docs). Read
  // from the URL once on mount, then strip the param so a refresh doesn't
  // re-trigger. Runs after the brain-reset effect above so opened tabs stick.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const keys = params
      .getAll("open")
      .flatMap((v) => v.split(","))
      .map((v) => v.trim())
      .filter(Boolean);
    if (keys.length === 0) return;
    keys.forEach((key, i) => openTab(key, i === keys.length - 1));
    const url = new URL(window.location.href);
    url.searchParams.delete("open");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dialog state carries its own `open` flag so the dialog stays mounted
  // while it animates out — unmounting it on close skips the transition.
  const [newItem, setNewItem] = React.useState<{
    mode: "file" | "folder";
    parentPrefix: string;
    open: boolean;
  }>({ mode: "file", parentPrefix: "", open: false });
  const [deleteTarget, setDeleteTarget] = React.useState<{
    key: string;
    isFolder: boolean;
    open: boolean;
  }>({ key: "", isFolder: false, open: false });
  const [addSourceOpen, setAddSourceOpen] = React.useState(false);

  const refresh = () => setRefreshKey((k) => k + 1);

  const uploading = React.useRef(false);
  const handleUploadFiles = React.useCallback(
    async (parentPrefix: string, files: File[]) => {
      if (uploading.current) {
        toast.info("Upload already in progress");
        return;
      }
      uploading.current = true;
      const toastId = toast.loading(
        files.length === 1 ? "Uploading file…" : `Uploading ${files.length} files…`
      );
      try {
        const result = await uploadMarkdownFiles(parentPrefix, files);
        const summary = describeUploadResult(result);
        if (summary.tone === "success") toast.success(summary.message, { id: toastId });
        else if (summary.tone === "error") toast.error(summary.message, { id: toastId });
        else toast.info(summary.message, { id: toastId });

        if (result.uploaded.length > 0) {
          setRefreshKey((k) => k + 1);
          const toOpen = result.uploaded.slice(-5);
          toOpen.forEach((key, i) => openTab(key, i === toOpen.length - 1));
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : String(error),
          { id: toastId }
        );
      } finally {
        uploading.current = false;
      }
    },
    [openTab]
  );

  const handleRenamed = React.useCallback(
    (from: string, to: string, isFolder: boolean) => {
      setOpenTabs((prev) => applyRenameToKeys(prev, from, to, isFolder));
      setActiveKey((cur) =>
        cur ? remapKeyAfterRename(cur, from, to, isFolder) : cur
      );
      setRefreshKey((k) => k + 1);
    },
    []
  );

  const handleDeleted = React.useCallback((key: string, isFolder: boolean) => {
    setOpenTabs((prev) => {
      const next = applyDeleteToKeys(prev, key, isFolder);
      setActiveKey((cur) => {
        if (!cur || !isRemovedByDelete(cur, key, isFolder)) return cur;
        if (next.length === 0) return null;
        const idx = prev.indexOf(cur);
        return next[Math.min(Math.max(idx, 0), next.length - 1)];
      });
      return next;
    });
    setRefreshKey((k) => k + 1);
  }, []);

  const openNewItem = (mode: "file" | "folder", parentPrefix: string) =>
    setNewItem({ mode, parentPrefix, open: true });

  const tree = (
    <KnowledgeSidebar
      selectedKey={activeKey}
      refreshKey={refreshKey}
      onSelectFile={(key) => openTab(key)}
      onOpenInNewTab={(key) => openTab(key, false)}
      onNewFile={(parentPrefix) => openNewItem("file", parentPrefix)}
      onNewFolder={(parentPrefix) => openNewItem("folder", parentPrefix)}
      onDelete={(key, isFolder) =>
        setDeleteTarget({ key, isFolder, open: true })
      }
      onMoved={handleRenamed}
      onAddSource={() => setAddSourceOpen(true)}
      onUploadFiles={handleUploadFiles}
    />
  );

  const toolbar = (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setAddSourceOpen(true)}
        className="hidden sm:inline-flex"
      >
        <Plus className="mr-1 h-3.5 w-3.5" /> Add source
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => openNewItem("folder", "")}
        className="hidden sm:inline-flex"
      >
        <FolderPlus className="mr-1 h-3.5 w-3.5" /> New folder
      </Button>
      <Button
        size="sm"
        onClick={() => openNewItem("file", "")}
        className="hidden sm:inline-flex"
      >
        <FilePlus className="mr-1 h-3.5 w-3.5" /> New file
      </Button>
      {/* Narrow screens get one menu instead of three icon buttons. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="icon-sm"
              className="sm:hidden"
              aria-label="Knowledge actions"
            />
          }
        >
          <Plus className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openNewItem("file", "")}>
            <FilePlus className="mr-2 h-3.5 w-3.5" /> New file
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openNewItem("folder", "")}>
            <FolderPlus className="mr-2 h-3.5 w-3.5" /> New folder
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setAddSourceOpen(true)}>
            <Plus className="mr-2 h-3.5 w-3.5" /> Add source
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  return (
    <AppShell
      title="Knowledge"
      subtitle="Shared team knowledge base"
      toolbar={toolbar}
      contextPanel={tree}
    >
      <BrainStatusGate>
        <div className="flex h-full min-h-0 flex-col">
          <KnowledgeTabs
            tabs={openTabs}
            activeKey={activeKey}
            onActivate={setActiveKey}
            onClose={closeTab}
          />
          <div className="min-h-0 flex-1">
            <KnowledgeViewer
              fileKey={activeKey}
              onDeleted={() => {
                if (activeKey) closeTab(activeKey);
                refresh();
              }}
              onOpenKey={(key) => openTab(key)}
              onUploadFiles={handleUploadFiles}
            />
          </div>
        </div>

        <NewItemDialog
          open={newItem.open}
          mode={newItem.mode}
          parentPrefix={newItem.parentPrefix}
          onOpenChange={(open) => setNewItem((prev) => ({ ...prev, open }))}
          onCreated={refresh}
        />

        <DeleteItemDialog
          open={deleteTarget.open}
          itemKey={deleteTarget.key}
          isFolder={deleteTarget.isFolder}
          onOpenChange={(open) =>
            setDeleteTarget((prev) => ({ ...prev, open }))
          }
          onDeleted={() =>
            handleDeleted(deleteTarget.key, deleteTarget.isFolder)
          }
        />

      </BrainStatusGate>

      <AddSourceDialog
        open={addSourceOpen}
        onOpenChange={setAddSourceOpen}
      />
    </AppShell>
  );
}
