"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, CircleDashed, Construction, Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

import "@/utils/amplify-client-config";

const SNIPPET_HTTP = `"context101": {
  "url": "https://nqdr4qhnun.us-east-1.awsapprunner.com/mcp",
  "headers": {
    "Authorization": "Bearer context101-platea-2026-bearer"
  }
}`;

const SNIPPET_STDIO = `"context101": {
  "command": "npx",
  "args": [
    "-y",
    "mcp-remote",
    "https://nqdr4qhnun.us-east-1.awsapprunner.com/mcp",
    "--header",
    "Authorization: Bearer context101-platea-2026-bearer"
  ]
}`;

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
      toast.error("Copy failed — select and copy manually");
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

function CopyMcpConfig() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Connect your MCP client</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <CopyableSnippet
          label="Cursor / Claude Code / Devin"
          snippet={SNIPPET_HTTP}
          note={
            "Paste into the mcpServers object in .cursor/mcp.json or the equivalent. Streamable-HTTP native."
          }
        />
        <CopyableSnippet
          label="Claude Desktop"
          snippet={SNIPPET_STDIO}
          note={
            "Claude Desktop only speaks stdio — mcp-remote is a tiny proxy (auto-installed by npx on first run). Paste into claude_desktop_config.json, then restart Claude Desktop."
          }
        />
      </CardContent>
    </Card>
  );
}

type Status = "done" | "in-progress" | "later";

function StatusBadge({ status }: { status: Status }) {
  if (status === "done")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> Done
      </span>
    );
  if (status === "in-progress")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
        <Construction className="h-3.5 w-3.5" /> In progress
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <CircleDashed className="h-3.5 w-3.5" /> Later
    </span>
  );
}

function Item({
  title,
  status,
  children,
}: {
  title: string;
  status: Status;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <div className="mt-1 shrink-0">
        <StatusBadge status={status} />
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}

export default function AboutPage() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="border-b px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
            </Button>
          </Link>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">About</h1>
            <p className="text-xs text-muted-foreground">
              What Context101 is and why it exists
            </p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <article className="mx-auto w-full max-w-3xl px-6 py-10 space-y-8">
        <section>
          <h2 className="text-2xl font-semibold tracking-tight mb-3">
            The problem
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Teams today are a mix of technical and non-technical people, and
            almost everyone uses an AI assistant now — engineers in Cursor /
            Claude Code / Devin, PMs and analysts in Claude Desktop, marketers
            in internal agents, and so on. The problem isn&apos;t that the
            tools are bad. It&apos;s that <strong>each person&apos;s AI only
            knows what that person has personally told it</strong>. Insight
            gets stuck inside individual chat sessions and doesn&apos;t
            propagate across the team. The handoffs break silently.
          </p>
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              A concrete (illustrative) example
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            <p>
              An <strong>analytics teammate</strong> spends a week uncovering
              that mobile conversion dropped 12% last quarter, and the
              /pricing page has a 73% exit rate. They draft the findings
              inside their Claude Desktop.
            </p>
            <p>
              A <strong>manager</strong> asks their own Claude Desktop: &quot;what
              should we prioritize for conversion?&quot; — but that AI has no
              access to the analytics teammate&apos;s findings. It gives a
              generic answer. The manager makes a decision on vibes instead
              of data.
            </p>
            <p>
              An <strong>engineer</strong> gets assigned to implement click
              tracking. They open Cursor and ask &quot;what needs to be tracked
              and why?&quot; — Cursor has no idea about the analytics or the
              manager&apos;s reasoning either. The chain of understanding
              breaks at every handoff.
            </p>
            <p className="italic">
              These roles are illustrative — not real people — but the shape
              of the problem is real.
            </p>
          </CardContent>
        </Card>

        <section>
          <h2 className="text-2xl font-semibold tracking-tight mb-3">
            Why not just use Devin?
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Purpose-built agents like Devin solve the engineering side of
            this problem well, but they&apos;re expensive and heavyweight for
            non-technical use cases. A social media manager asking &quot;how did
            our Instagram post perform this week?&quot; shouldn&apos;t burn Devin
            credits. Red Ventures already has an in-house agent that&apos;s
            better suited for those lighter-weight queries. Different roles
            use different agents, and that&apos;s fine — but{" "}
            <strong>
              every one of those agents still needs the same underlying team
              knowledge
            </strong>
            .
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground mt-3">
            Maintaining a separate knowledge store per agent is a
            nightmare — you&apos;d be copy-pasting or building N integrations.
            Instead, we centralize the knowledge and expose it through
            <strong> MCP</strong> (Model Context Protocol), the open standard
            Anthropic defined exactly for this. Any MCP-compatible client
            plugs into the same brain with zero custom work.
          </p>
        </section>

        <CopyMcpConfig />

        <section>
          <h2 className="text-2xl font-semibold tracking-tight mb-3">
            How Context101 fits in
          </h2>
          <div className="rounded-md border bg-muted/30 p-4 mb-4 font-mono text-xs whitespace-pre overflow-x-auto">
            {`Claude Desktop    Cursor     Claude Code    Devin      RV agent
      │            │            │          │           │
      └────────────┴─────[MCP protocol]─────┴───────────┘
                                │
                    ┌─────────────────────┐
                    │     Context101      │
                    │  (this application) │
                    └──────────┬──────────┘
                               │
                ┌──────────────┴──────────────┐
                ▼                             ▼
         Bedrock KB                     S3 docs bucket
         (Titan v2, S3 Vectors)    (markdown, versioned)
`}
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            One source of truth; many consumers. Write a fact once here —
            whether via this web UI or by dropping a markdown file into the
            repo — and within a minute every teammate&apos;s AI agent can
            retrieve it via semantic search. No per-tool integrations, no
            manual context-pasting.
          </p>
        </section>

        <Separator />

        <section>
          <h2 className="text-2xl font-semibold tracking-tight mb-3">
            Current PoC status
          </h2>
          <ul className="space-y-4">
            <Item title="Infrastructure as code (CDK)" status="done">
              The whole stack — S3, Bedrock KB, S3 Vectors, Lambda,
              App Runner, Amplify Hosting — comes up from a single{" "}
              <code className="font-mono text-xs">cdk deploy</code>.
            </Item>
            <Item title="Knowledge base with semantic search" status="done">
              Amazon Bedrock Knowledge Base backed by S3 Vectors, using
              Titan embed v2 (1024-dim). Auto-indexes new docs within ~1 min
              of upload.
            </Item>
            <Item title="MCP server with bearer auth" status="done">
              FastMCP container on AWS App Runner exposing{" "}
              <code className="font-mono text-xs">search_knowledge</code>,{" "}
              <code className="font-mono text-xs">read_knowledge</code>,{" "}
              <code className="font-mono text-xs">list_sources</code>. Team
              points their MCP clients at one URL with a shared bearer
              token.
            </Item>
            <Item title="Admin web app with CRUD" status="done">
              This application. Cognito-authenticated. Folder tree,
              preview tabs (Markdown / CSV / JSON), create / edit / delete /
              rename with right-click. Backed by the same S3 bucket the MCP
              reads from.
            </Item>
            <Item title="Notion sync" status="later">
              First iteration: teammates manually export Notion pages to
              markdown and drop them in. Automate later if it becomes painful
              (script or Zapier / cron Lambda).
            </Item>
            <Item title="Metadata sidecars for filtered retrieval" status="later">
              <code className="font-mono text-xs">.metadata.json</code>{" "}
              files alongside each doc with attributes like{" "}
              <code className="font-mono text-xs">team</code>,{" "}
              <code className="font-mono text-xs">source</code>. Agents can
              scope queries (&quot;only Platea docs&quot;).
            </Item>
            <Item title="Per-user auth (Cognito JWT) for the MCP" status="later">
              Graduate from the shared bearer token once we need per-person
              audit trails. Swap FastMCP&apos;s StaticTokenVerifier for a JWT
              verifier pointing at the Cognito user pool.
            </Item>
            <Item
              title="Migrate App Runner → ECS Express Mode"
              status="later"
            >
              AWS announced App Runner is closed to new customers from April
              2026. Existing services keep working. No rush — hold until AWS
              announces an actual EOL date or ECS Express Mode matures.
            </Item>
          </ul>
        </section>
      </article>
    </main>
  );
}
