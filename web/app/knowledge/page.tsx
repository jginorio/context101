"use client";

import * as React from "react";
import { FilePlus, FolderPlus } from "lucide-react";

import { KnowledgeSidebar } from "@/components/knowledge-sidebar";
import { KnowledgeViewer } from "@/components/knowledge-viewer";
import { NewItemDialog } from "@/components/new-item-dialog";
import { RenameDialog } from "@/components/rename-dialog";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";
import { BrainStatusGate } from "@/components/brain-status-gate";
import { useBrain } from "@/lib/brain-context";

export default function Home() {
  const { currentBrainId } = useBrain();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  // Switching brain → clear the open file (it lives in the previous brain's
  // bucket) and bump the tree refresh key so it re-fetches against the new
  // brain. The cookie/URL update happens in `setBrain` inside BrainProvider.
  React.useEffect(() => {
    setSelected(null);
    setRefreshKey((k) => k + 1);
  }, [currentBrainId]);

  const [newItem, setNewItem] = React.useState<{
    mode: "file" | "folder";
    parentPrefix: string;
  } | null>(null);
  const [rename, setRename] = React.useState<{
    key: string;
    isFolder: boolean;
  } | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);

  const tree = (
    <KnowledgeSidebar
      selectedKey={selected}
      refreshKey={refreshKey}
      onSelectFile={(key) => setSelected(key)}
      onNewFile={(parentPrefix) => setNewItem({ mode: "file", parentPrefix })}
      onNewFolder={(parentPrefix) =>
        setNewItem({ mode: "folder", parentPrefix })
      }
      onRename={(key, isFolder) => setRename({ key, isFolder })}
      onDeleted={(key) => {
        if (selected === key) setSelected(null);
        refresh();
      }}
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
        <KnowledgeViewer
          fileKey={selected}
          onDeleted={() => {
            setSelected(null);
            refresh();
          }}
        />

        {newItem && (
          <NewItemDialog
            open={!!newItem}
            mode={newItem.mode}
            parentPrefix={newItem.parentPrefix}
            onOpenChange={(o) => !o && setNewItem(null)}
            onCreated={refresh}
          />
        )}

        {rename && (
          <RenameDialog
            open={!!rename}
            currentKey={rename.key}
            isFolder={rename.isFolder}
            onOpenChange={(o) => !o && setRename(null)}
            onRenamed={(newKey) => {
              if (selected === rename.key) setSelected(newKey);
              refresh();
            }}
          />
        )}
      </BrainStatusGate>
    </AppShell>
  );
}
