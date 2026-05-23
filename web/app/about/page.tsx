"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Brain,
  Check,
  Copy,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useBrain, type ClientBrain } from "@/lib/brain-context";

import "@/utils/amplify-client-config";

const MCP_HOST = process.env.NEXT_PUBLIC_MCP_HOST ?? "";

function brainMcpUrl(brainId: string): string {
  if (!MCP_HOST) return `<your-mcp-host>/brain/${brainId}/mcp`;
  return `${MCP_HOST.replace(/\/$/, "")}/brain/${brainId}/mcp`;
}

function brainConfigKey(brainId: string): string {
  return brainId === "default" ? "context101" : `context101-${brainId}`;
}

function snippetHttp(brainId: string, token: string): string {
  return `"${brainConfigKey(brainId)}": {
  "url": "${brainMcpUrl(brainId)}",
  "headers": {
    "Authorization": "Bearer ${token}"
  }
}`;
}

function snippetStdio(brainId: string, token: string): string {
  return `"${brainConfigKey(brainId)}": {
  "command": "npx",
  "args": [
    "-y",
    "mcp-remote",
    "${brainMcpUrl(brainId)}",
    "--header",
    "Authorization: Bearer ${token}"
  ]
}`;
}

function CopyableSnippet({
  label,
  snippet,
  note,
}: {
  label: string;
  snippet: string;
  note: string;
}) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      toast.success(`${label} config copied`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed. Select and copy manually.");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        <Button size="sm" variant="outline" onClick={copy}>
          {copied ? (
            <Check className="mr-1 h-3.5 w-3.5" />
          ) : (
            <Copy className="mr-1 h-3.5 w-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{note}</p>
      <pre className="text-xs font-mono whitespace-pre overflow-x-auto rounded-md border bg-muted/30 p-3">
        {snippet}
      </pre>
    </div>
  );
}

type TokenState =
  | { status: "loading" }
  | { status: "loaded"; token: string }
  | { status: "error"; error: string };

function BrainMcpConfig({ brain }: { brain: ClientBrain }) {
  const [state, setState] = React.useState<TokenState>({ status: "loading" });

  React.useEffect(() => {
    let alive = true;

    async function loadToken() {
      try {
        const res = await fetch(
          `/api/brains/${encodeURIComponent(brain.brain_id)}/token`,
          { cache: "no-store" }
        );
        if (!alive) return;
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setState({
            status: "error",
            error: data?.error ?? `token fetch failed (${res.status})`,
          });
          return;
        }
        const data = (await res.json()) as { token?: string };
        setState({ status: "loaded", token: data.token ?? "" });
      } catch (e) {
        if (!alive) return;
        setState({
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    void loadToken();
    return () => {
      alive = false;
    };
  }, [brain.brain_id]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Brain className="h-4 w-4" />
          {brain.display_name}
          <span className="text-xs font-mono text-muted-foreground font-normal">
            {brain.brain_id}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {state.status === "error" ? (
          <p className="text-sm text-red-600 dark:text-red-400 inline-flex items-center gap-1">
            <AlertCircle className="h-3.5 w-3.5" /> {state.error}
          </p>
        ) : state.status === "loading" ? (
          <p className="text-sm text-muted-foreground inline-flex items-center gap-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading token...
          </p>
        ) : (
          <>
            <CopyableSnippet
              label="Cursor / Claude Code / Devin"
              snippet={snippetHttp(brain.brain_id, state.token)}
              note="Paste into the mcpServers object in .cursor/mcp.json or the equivalent."
            />
            <CopyableSnippet
              label="Claude Desktop"
              snippet={snippetStdio(brain.brain_id, state.token)}
              note="Claude Desktop uses mcp-remote as a local stdio-to-HTTP proxy."
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CopyMcpConfig() {
  const { brains, loading } = useBrain();
  const ready = brains.filter((b) => b.status === "ready");

  if (loading && ready.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading brains...
        </CardContent>
      </Card>
    );
  }

  if (ready.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connect an MCP client</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No brains are ready yet. Create one from{" "}
            <Link href="/brains" className="underline">
              /brains
            </Link>{" "}
            to get an MCP config snippet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl sm:text-2xl font-semibold tracking-tight mb-1">
          Connect an MCP client
        </h2>
        <p className="text-sm text-muted-foreground">
          One snippet per brain. Each brain has its own URL and bearer token.
        </p>
      </div>
      {ready.map((brain) => (
        <BrainMcpConfig key={brain.brain_id} brain={brain} />
      ))}
    </section>
  );
}

const caveats = [
  {
    title: "Trusted internal users only",
    body: "Every signed-in user can currently operate across brains and reveal MCP bearer tokens. Do not expose this app to untrusted users.",
  },
  {
    title: "Alpha connector layer",
    body: "Google Workspace, Notion, and GitHub connectors sync into markdown, but the flows are intentionally simple. GitHub uses a pasted PAT today.",
  },
  {
    title: "Self-hosted first",
    body: "This deployment runs in your AWS account. Managed hosting needs RBAC, audit logs, tenant isolation, and billing boundaries before it is real.",
  },
];

export default function AboutPage() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="border-b px-3 sm:px-6 py-3 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Link href="/knowledge">
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex">
              <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="sm:hidden"
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-semibold tracking-tight truncate">
              About this deployment
            </h1>
            <p className="text-xs text-muted-foreground hidden sm:block truncate">
              MCP setup, alpha caveats, and current operating model
            </p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <article className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 sm:py-10 space-y-6 sm:space-y-8">
        <section className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5" />
            Alpha software for trusted internal teams
          </div>
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Context101 is your shared MCP knowledge base.
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            This app manages the brains, files, suggestions, wiki generation,
            sources, and MCP connection snippets for this self-hosted
            deployment. The public homepage lives outside this app so internal
            deployments stay focused on operations.
          </p>
        </section>

        <CopyMcpConfig />

        <Separator />

        <section className="space-y-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-semibold tracking-tight mb-1">
              Current caveats
            </h2>
            <p className="text-sm text-muted-foreground">
              These are intentional alpha constraints, not hidden fine print.
            </p>
          </div>
          <div className="grid gap-3">
            {caveats.map((item) => (
              <Card key={item.title}>
                <CardHeader>
                  <CardTitle className="text-base">{item.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {item.body}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </article>
    </main>
  );
}
