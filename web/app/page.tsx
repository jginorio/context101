"use client";

import * as React from "react";
import "@aws-amplify/ui-react/styles.css";
import { signOut } from "aws-amplify/auth";
import Link from "next/link";
import { BookOpen, FilePlus, FolderPlus, Info } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { KnowledgeTree } from "@/components/knowledge-tree";
import { KnowledgeViewer } from "@/components/knowledge-viewer";
import { NewItemDialog } from "@/components/new-item-dialog";
import { RenameDialog } from "@/components/rename-dialog";
import { Button } from "@/components/ui/button";

import "@/utils/amplify-client-config";

export default function Home() {
  const [selected, setSelected] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  const [newItem, setNewItem] = React.useState<{
    mode: "file" | "folder";
    parentPrefix: string;
  } | null>(null);
  const [rename, setRename] = React.useState<{
    key: string;
    isFolder: boolean;
  } | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <main className="flex h-screen flex-col">
      <header className="border-b px-6 py-3 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Context101</h1>
          <p className="text-xs text-muted-foreground">
            Shared team knowledge base
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setNewItem({ mode: "folder", parentPrefix: "" })}
          >
            <FolderPlus className="mr-1 h-3.5 w-3.5" /> New folder
          </Button>
          <Button
            size="sm"
            onClick={() => setNewItem({ mode: "file", parentPrefix: "" })}
          >
            <FilePlus className="mr-1 h-3.5 w-3.5" /> New file
          </Button>
          <Link href="/wiki">
            <Button variant="ghost" size="sm">
              <BookOpen className="mr-1 h-3.5 w-3.5" /> Wiki
            </Button>
          </Link>
          <Link href="/about">
            <Button variant="ghost" size="sm">
              <Info className="mr-1 h-3.5 w-3.5" /> About
            </Button>
          </Link>
          <ThemeToggle />
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              signOut().then(() => (window.location.href = "/login"))
            }
          >
            Sign out
          </Button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="w-72 border-r overflow-y-auto p-2 shrink-0">
          <KnowledgeTree
            selectedKey={selected}
            refreshKey={refreshKey}
            onSelectFile={setSelected}
            onNewFile={(parentPrefix) =>
              setNewItem({ mode: "file", parentPrefix })
            }
            onNewFolder={(parentPrefix) =>
              setNewItem({ mode: "folder", parentPrefix })
            }
            onRename={(key, isFolder) => setRename({ key, isFolder })}
            onDeleted={(key) => {
              if (selected === key) setSelected(null);
              refresh();
            }}
          />
        </aside>
        <section className="flex-1 min-w-0">
          <KnowledgeViewer
            fileKey={selected}
            onDeleted={() => {
              setSelected(null);
              refresh();
            }}
          />
        </section>
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
    </main>
  );
}
