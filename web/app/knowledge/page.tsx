"use client";

import * as React from "react";
import { FilePlus, FolderPlus } from "lucide-react";

import { KnowledgeSidebar } from "@/components/knowledge-sidebar";
import { KnowledgeTabs } from "@/components/knowledge-tabs";
import { KnowledgeViewer } from "@/components/knowledge-viewer";
import { NewItemDialog } from "@/components/new-item-dialog";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";
import { BrainStatusGate } from "@/components/brain-status-gate";
import { useBrain } from "@/lib/brain-context";

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

  const [newItem, setNewItem] = React.useState<{
    mode: "file" | "folder";
    parentPrefix: string;
  } | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);

  const tree = (
    <KnowledgeSidebar
      selectedKey={activeKey}
      refreshKey={refreshKey}
      onSelectFile={(key) => openTab(key)}
      onOpenInNewTab={(key) => openTab(key, false)}
      onNewFile={(parentPrefix) => setNewItem({ mode: "file", parentPrefix })}
      onNewFolder={(parentPrefix) =>
        setNewItem({ mode: "folder", parentPrefix })
      }
    />
  );

  const toolbar = (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setNewItem({ mode: "folder", parentPrefix: "" })}
        className="hidden sm:inline-flex"
      >
        <FolderPlus className="mr-1 h-3.5 w-3.5" /> New folder
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => setNewItem({ mode: "folder", parentPrefix: "" })}
        className="sm:hidden"
        aria-label="New folder"
      >
        <FolderPlus className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="sm"
        onClick={() => setNewItem({ mode: "file", parentPrefix: "" })}
        className="hidden sm:inline-flex"
      >
        <FilePlus className="mr-1 h-3.5 w-3.5" /> New file
      </Button>
      <Button
        size="icon-sm"
        onClick={() => setNewItem({ mode: "file", parentPrefix: "" })}
        className="sm:hidden"
        aria-label="New file"
      >
        <FilePlus className="h-3.5 w-3.5" />
      </Button>
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
            />
          </div>
        </div>

        {newItem && (
          <NewItemDialog
            open={!!newItem}
            mode={newItem.mode}
            parentPrefix={newItem.parentPrefix}
            onOpenChange={(o) => !o && setNewItem(null)}
            onCreated={refresh}
          />
        )}

      </BrainStatusGate>
    </AppShell>
  );
}
