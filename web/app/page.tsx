"use client";

import * as React from "react";
import "@aws-amplify/ui-react/styles.css";
import { signOut } from "aws-amplify/auth";

import { ThemeToggle } from "@/components/theme-toggle";
import { KnowledgeTree } from "@/components/knowledge-tree";
import { KnowledgeViewer } from "@/components/knowledge-viewer";
import { Button } from "@/components/ui/button";

import "@/utils/amplify-client-config";

export default function Home() {
  const [selected, setSelected] = React.useState<string | null>(null);

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
          <ThemeToggle />
          <Button
            variant="outline"
            size="sm"
            onClick={() => signOut().then(() => (window.location.href = "/login"))}
          >
            Sign out
          </Button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="w-72 border-r overflow-y-auto p-2 shrink-0">
          <KnowledgeTree
            selectedKey={selected}
            onSelectFile={setSelected}
          />
        </aside>
        <section className="flex-1 min-w-0">
          <KnowledgeViewer fileKey={selected} />
        </section>
      </div>
    </main>
  );
}
