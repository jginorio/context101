"use client";

import * as React from "react";
import "@aws-amplify/ui-react/styles.css";
import { signOut } from "aws-amplify/auth";
import Link from "next/link";
import {
  BookOpen,
  FilePlus,
  FolderPlus,
  Info,
  Menu,
  Plug,
  Sparkles,
} from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { KnowledgeTree } from "@/components/knowledge-tree";
import { KnowledgeViewer } from "@/components/knowledge-viewer";
import { NewItemDialog } from "@/components/new-item-dialog";
import { RenameDialog } from "@/components/rename-dialog";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

import "@/utils/amplify-client-config";

export default function Home() {
  const [selected, setSelected] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

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
    <KnowledgeTree
      selectedKey={selected}
      refreshKey={refreshKey}
      onSelectFile={(key) => {
        setSelected(key);
        setMobileNavOpen(false);
      }}
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
  );

  return (
    <main className="flex h-screen flex-col">
      <header className="border-b px-3 sm:px-6 py-3 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="md:hidden shrink-0"
                  aria-label="Open menu"
                />
              }
            >
              <Menu className="h-4 w-4" />
            </SheetTrigger>
            <SheetContent side="left" className="w-[85vw] max-w-sm p-0 flex flex-col">
              <SheetHeader>
                <SheetTitle>Context101</SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col gap-1 px-2 pb-2 border-b">
                <Link href="/wiki" onClick={() => setMobileNavOpen(false)}>
                  <Button variant="ghost" size="sm" className="w-full justify-start">
                    <BookOpen className="mr-2 h-3.5 w-3.5" /> Wiki
                  </Button>
                </Link>
                <Link href="/suggestions" onClick={() => setMobileNavOpen(false)}>
                  <Button variant="ghost" size="sm" className="w-full justify-start">
                    <Sparkles className="mr-2 h-3.5 w-3.5" /> Suggestions
                  </Button>
                </Link>
                <Link href="/sources" onClick={() => setMobileNavOpen(false)}>
                  <Button variant="ghost" size="sm" className="w-full justify-start">
                    <Plug className="mr-2 h-3.5 w-3.5" /> Sources
                  </Button>
                </Link>
                <Link href="/about" onClick={() => setMobileNavOpen(false)}>
                  <Button variant="ghost" size="sm" className="w-full justify-start">
                    <Info className="mr-2 h-3.5 w-3.5" /> About
                  </Button>
                </Link>
              </nav>
              <div className="flex-1 min-h-0 overflow-y-auto p-2">{tree}</div>
            </SheetContent>
          </Sheet>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-semibold tracking-tight truncate">
              Context101
            </h1>
            <p className="text-xs text-muted-foreground hidden sm:block">
              Shared team knowledge base
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
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
          <Link href="/wiki" className="hidden md:inline-flex">
            <Button variant="ghost" size="sm">
              <BookOpen className="mr-1 h-3.5 w-3.5" /> Wiki
            </Button>
          </Link>
          <Link href="/suggestions" className="hidden md:inline-flex">
            <Button variant="ghost" size="sm">
              <Sparkles className="mr-1 h-3.5 w-3.5" /> Suggestions
            </Button>
          </Link>
          <Link href="/sources" className="hidden md:inline-flex">
            <Button variant="ghost" size="sm">
              <Plug className="mr-1 h-3.5 w-3.5" /> Sources
            </Button>
          </Link>
          <Link href="/about" className="hidden md:inline-flex">
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
            className="hidden sm:inline-flex"
          >
            Sign out
          </Button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="hidden md:block w-72 border-r overflow-y-auto p-2 shrink-0">
          {tree}
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
