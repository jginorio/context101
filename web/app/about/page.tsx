"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  CircleDashed,
  Construction,
  Copy,
  Download,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

import "@/utils/amplify-client-config";

const MCP_URL =
  process.env.NEXT_PUBLIC_MCP_URL ?? "https://<your-mcp-host>/mcp";
const MCP_TOKEN =
  process.env.NEXT_PUBLIC_MCP_TOKEN ?? "<your-shared-bearer-token>";

const SNIPPET_HTTP = `"context101": {
  "url": "${MCP_URL}",
  "headers": {
    "Authorization": "Bearer ${MCP_TOKEN}"
  }
}`;

const SNIPPET_STDIO = `"context101": {
  "command": "npx",
  "args": [
    "-y",
    "mcp-remote",
    "${MCP_URL}",
    "--header",
    "Authorization: Bearer ${MCP_TOKEN}"
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

function BootstrapInstaller() {
  // The script is copied into web/public/install-mcps.sh by the build step
  // (see web/package.json). It's served at the root: /install-mcps.sh.
  // Curl uses a relative URL so this works on any deploy / preview domain.
  const ONELINER = `bash <(curl -fsSL ${
    typeof window === "undefined"
      ? "https://your-deploy.amplifyapp.com"
      : window.location.origin
  }/install-mcps.sh)`;

  const [copied, setCopied] = React.useState(false);
  async function copyOneliner() {
    try {
      await navigator.clipboard.writeText(ONELINER);
      setCopied(true);
      toast.success("One-liner copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed — select and copy manually");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Terminal className="h-4 w-4" />
          One-shot installer (macOS)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground leading-relaxed">
          A bash script that bootstraps your machine with the team&apos;s MCP
          servers — Homebrew, <code className="font-mono text-xs">uv</code>,{" "}
          <code className="font-mono text-xs">pipx</code>,{" "}
          <code className="font-mono text-xs">gcloud</code>, Node 20 — then
          walks you through Context101, Metabase, Google Analytics,
          Contentful, Iterable, and Sprout Social, and merges them into your
          Claude Desktop config (with a backup of the existing file).
        </p>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Run it</p>
            <Button size="sm" variant="outline" onClick={copyOneliner}>
              {copied ? (
                <Check className="mr-1 h-3.5 w-3.5" />
              ) : (
                <Copy className="mr-1 h-3.5 w-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <pre className="text-xs font-mono whitespace-pre overflow-x-auto rounded-md border bg-muted/30 p-3">
            {ONELINER}
          </pre>
          <p className="text-xs text-muted-foreground">
            Pipes the script straight into bash. The interactive prompts
            (selection menu, credential paste fields) work because{" "}
            <code className="font-mono text-xs">bash &lt;(...)</code> keeps
            stdin attached to your terminal — unlike{" "}
            <code className="font-mono text-xs">curl ... | bash</code>.
          </p>
        </div>

        <Separator />

        <div className="space-y-2">
          <p className="text-sm font-medium">…or download + inspect first</p>
          <div className="flex flex-wrap items-center gap-2">
            <a href="/install-mcps.sh" download="install-mcps.sh">
              <Button size="sm" variant="outline">
                <Download className="mr-1 h-3.5 w-3.5" /> Download script
              </Button>
            </a>
            <a
              href="/install-mcps.sh"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              View raw
            </a>
          </div>
          <p className="text-xs text-muted-foreground">
            Read it, then{" "}
            <code className="font-mono text-xs">
              chmod +x install-mcps.sh && ./install-mcps.sh
            </code>
            . Re-running it later is idempotent — picks back up where you
            left off.
          </p>
        </div>
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
      <header className="border-b px-3 sm:px-6 py-3 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Link href="/">
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex">
              <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
            </Button>
            <Button variant="ghost" size="icon-sm" className="sm:hidden" aria-label="Back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-semibold tracking-tight truncate">
              About
            </h1>
            <p className="text-xs text-muted-foreground hidden sm:block truncate">
              What Context101 is and why it exists
            </p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <article className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 sm:py-10 space-y-6 sm:space-y-8">
        <section>
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight mb-3">
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
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight mb-3">
            Why not just use Devin?
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Purpose-built agents like Devin solve the engineering side of
            this problem well, but they&apos;re expensive and heavyweight for
            non-technical use cases. A social media manager asking &quot;how did
            our Instagram post perform this week?&quot; shouldn&apos;t burn Devin
            credits — a lighter in-house agent or a plain Claude Desktop
            session is a better fit. Different roles use different agents,
            and that&apos;s fine — but{" "}
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

        <BootstrapInstaller />

        <section>
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight mb-3">
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
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight mb-3">
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
              <code className="font-mono text-xs">list_sources</code>,{" "}
              <code className="font-mono text-xs">suggest_knowledge</code>.
              Team
              points their MCP clients at one URL with a shared bearer
              token.
            </Item>
            <Item title="Admin web app with CRUD" status="done">
              This application. Cognito-authenticated. Folder tree,
              preview tabs (Markdown / CSV / JSON), create / edit / delete /
              rename with right-click. Backed by the same S3 bucket the MCP
              reads from.
            </Item>
            <Item title="Google Workspace + Notion connectors (OAuth)" status="done">
              Connect a <strong>Google Sheet, Doc, Slides deck, or Notion page/database</strong>{" "}
              from the <Link href="/sources" className="underline">Sources</Link>{" "}
              tab. After provider consent, the connector pulls the content,
              renders it to markdown, writes to{" "}
              <code className="font-mono text-xs">sources/&lt;type&gt;/…</code>,
              and re-syncs every 6 hours. Files are read-only in the UI
              (edits would be clobbered by the next sync). Per-connection
              refresh / access tokens live in Secrets Manager.
            </Item>
            <Item title="GitHub connector + per-repo code wiki" status="done">
              Connect a repo with a Personal Access Token; every code +
              markdown file lands at{" "}
              <code className="font-mono text-xs">sources/github/&lt;repo&gt;/…</code>{" "}
              wrapped in fenced markdown. After each sync, a dedicated
              Fargate task generates a deepwiki-style{" "}
              <strong>per-repo code wiki</strong> at{" "}
              <code className="font-mono text-xs">wiki/code/&lt;repo&gt;/</code>
              {" "}— architecture, data flow, module diagrams, configuration.
              The team-level wiki then cites those pre-synthesized code
              pages alongside Notion / Sheets / Docs sources, so a single
              wiki page can explain strategy + metrics + implementation in
              one place.
            </Item>
            <Item title="Code wikis browsable in /wiki" status="done">
              The wiki sidebar has a <strong>Code wikis</strong> group below
              the team wiki, with one collapsible section per connected
              GitHub repo. Pages come from{" "}
              <code className="font-mono text-xs">wiki/code/&lt;repo&gt;/_index.json</code>.
              Selecting a code-wiki page swaps the right-side panel to that
              repo&apos;s last-indexed timestamp and page count.
            </Item>
            <Item title="Manual-only wiki regen" status="done">
              Wiki regen costs ~$0.30-0.80/run in Opus, so both auto-paths
              are off by default: the team-wiki EventBridge schedule is
              created with{" "}
              <code className="font-mono text-xs">enabled: false</code>, and
              the GitHub connector&apos;s post-sync code-wiki dispatch is
              gated behind{" "}
              <code className="font-mono text-xs">AUTO_TRIGGER_CODE_WIKI</code>{" "}
              (unset). Team wiki regenerates on the <strong>Refresh now</strong>{" "}
              button; code wikis via a manual{" "}
              <code className="font-mono text-xs">start-wiki-gen</code>{" "}
              invoke. Tree-SHA + corpus-SHA cost guards still ride along
              if you re-enable either auto-path.
            </Item>
            <Item title="GitHub OAuth (replace PAT)" status="later">
              Today GitHub auth is a PAT pasted into the dialog — simple but
              tied to whoever generated it, with no per-user audit. A
              GitHub App / OAuth flow would scope per-user and avoid the
              token-rotation footgun with{" "}
              <code className="font-mono text-xs">gho_</code> tokens.
            </Item>
            <Item title="Metadata sidecars for filtered retrieval" status="later">
              <code className="font-mono text-xs">.metadata.json</code>{" "}
              files alongside each doc with attributes like{" "}
              <code className="font-mono text-xs">team</code>,{" "}
              <code className="font-mono text-xs">source</code>. Agents can
              scope queries (e.g. &quot;only docs tagged{" "}
              <code className="font-mono text-xs">team=marketing</code>&quot;).
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
