import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Cloud,
  ExternalLink,
  Layers,
  Plug,
  Server,
  ShieldCheck,
  Star,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { ConnectionDiagram } from "@/components/landing/connection-diagram";
import { TextReveal } from "@/components/landing/text-reveal";
import { TypingRotate } from "@/components/landing/typing-rotate";

export const metadata: Metadata = {
  title: "Context101 — one brain, every AI tool",
  description:
    "A self-hosted, MCP-native knowledge base. Write team knowledge once; Cursor, Claude Code, Claude Desktop, Devin, and any MCP-compatible agent retrieve from it.",
};

const REPO_URL = "https://github.com/jginorio/context101";

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col">
      <SiteHeader />
      <Hero />
      <ProblemSection />
      <DiagramSection />
      <FeaturesSection />
      <ArchitectureSection />
      <ScopeSection />
      <QuickstartSection />
      <FinalCTA />
      <SiteFooter />
    </main>
  );
}

/* ── Header ───────────────────────────────────────────────────────── */

function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="inline-block size-2 rounded-full bg-primary" />
          <span className="text-sm font-semibold tracking-tight">
            Context101
          </span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/about"
            className="hidden text-xs text-muted-foreground hover:text-foreground sm:inline px-2"
          >
            About
          </Link>
          <Link
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden text-xs text-muted-foreground hover:text-foreground sm:inline px-2"
          >
            GitHub
          </Link>
          <ThemeToggle />
          <Link href="/login?next=/knowledge">
            <Button size="sm">
              Open app
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </Link>
        </nav>
      </div>
    </header>
  );
}

/* ── Hero ─────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Subtle background grid + radial glow — pure CSS, no deps. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 [background-image:linear-gradient(to_right,oklch(var(--foreground)/.04)_1px,transparent_1px),linear-gradient(to_bottom,oklch(var(--foreground)/.04)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]"
      />
      <div className="mx-auto w-full max-w-6xl px-4 pt-16 pb-12 sm:px-6 sm:pt-24 sm:pb-20">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border bg-background/60 px-3 py-1 text-xs text-muted-foreground">
            <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
            Open source · MCP-native · Self-hosted on AWS
          </div>

          <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
            One brain. Every AI tool.
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Context101 is a self-hosted knowledge base your team writes into{" "}
            once. Cursor, Claude Code, Claude Desktop, Devin, and any
            MCP-compatible agent retrieves from it — no per-tool integrations,
            no copy-pasted context.
          </p>

          <div className="mx-auto mt-7 flex max-w-md flex-col items-center justify-center gap-2 text-sm text-muted-foreground sm:flex-row sm:gap-3">
            <span>So now</span>
            <TypingRotate
              className="text-foreground"
              phrases={[
                "Cursor knows this.",
                "Claude Code knows this.",
                "Claude Desktop knows this.",
                "Devin knows this.",
                "Your custom agent knows this.",
              ]}
            />
          </div>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href={REPO_URL} target="_blank" rel="noreferrer">
              <Button size="lg">
                <Star className="mr-1.5 h-4 w-4" />
                View on GitHub
              </Button>
            </Link>
            <Link href={REPO_URL} target="_blank" rel="noreferrer">
              <Button size="lg" variant="outline">
                Read the docs
                <ExternalLink className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Problem ──────────────────────────────────────────────────────── */

function ProblemSection() {
  return (
    <section className="border-y bg-muted/30">
      <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
        <TextReveal
          as="h2"
          className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          Knowledge gets stuck in chat sessions.
        </TextReveal>
        <p className="mt-5 text-base leading-relaxed text-muted-foreground sm:text-lg">
          Every teammate&apos;s AI only knows what that person has told it. The
          analyst&apos;s findings stay inside their Claude Desktop. The PM asks
          their own AI and gets a generic answer. The engineer in Cursor
          restarts from zero context.
        </p>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
          Decisions get made on fragmented memory, and the chain of
          understanding breaks at every handoff.
        </p>
      </div>
    </section>
  );
}

/* ── Diagram ──────────────────────────────────────────────────────── */

function DiagramSection() {
  return (
    <section>
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <div className="mx-auto mb-12 max-w-2xl text-center sm:mb-16">
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Write once. Retrieve from everywhere.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            MCP is the open protocol Anthropic defined for exactly this. Any
            MCP-compatible client plugs into the same brain with zero custom
            work — no SDK lock-in, no per-tool wiring.
          </p>
        </div>

        <div className="mx-auto max-w-5xl">
          <ConnectionDiagram />
        </div>

        <p className="mx-auto mt-10 max-w-xl text-center text-sm text-muted-foreground">
          One source of truth. Many consumers. The brain lives in your AWS
          account, not someone else&apos;s SaaS.
        </p>
      </div>
    </section>
  );
}

/* ── Features ─────────────────────────────────────────────────────── */

const FEATURES = [
  {
    Icon: Layers,
    title: "Reconciled answers, not duplicate chunks",
    body: "A scheduled Opus job synthesizes the raw corpus into a canonical wiki with citations. Search returns the reconciled version; raw originals are one call away when you need to verify.",
  },
  {
    Icon: ShieldCheck,
    title: "Agents propose. Humans approve.",
    body: "Agents can suggest new knowledge as they work via the MCP. Proposals land in a review queue — nothing reaches the brain until you accept it in the UI.",
  },
  {
    Icon: Cloud,
    title: "Your AWS account. No per-seat pricing.",
    body: "Runs on managed AWS primitives at ~$5–15/mo at PoC scale. Cost scales with content, not headcount. Data never leaves your perimeter.",
  },
  {
    Icon: Plug,
    title: "Connectors that don't lock you in",
    body: "Google Sheets, Docs, Slides, Notion, and GitHub all re-sync into the same retrieval surface every 6h. Source data stays in its home tool.",
  },
];

function FeaturesSection() {
  return (
    <section className="border-y bg-muted/30">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            What you actually get
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            Four design choices that make Context101 distinct from a vanilla
            RAG server.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map(({ Icon, title, body }) => (
            <Card key={title}>
              <CardHeader>
                <div className="mb-2 flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
                  <Icon className="size-4" />
                </div>
                <CardTitle className="text-base sm:text-lg">{title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {body}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Architecture ─────────────────────────────────────────────────── */

const STACK = [
  "Bedrock Knowledge Bases",
  "S3 Vectors",
  "Titan embed v2",
  "FastMCP (Python)",
  "App Runner",
  "AWS CDK",
  "Next.js 16",
  "Amplify Hosting",
];

function ArchitectureSection() {
  return (
    <section>
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border bg-background/60 px-3 py-1 text-xs text-muted-foreground">
              <Server className="size-3" />
              For engineers
            </div>
            <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Boring managed primitives, wired up by CDK.
            </h2>
            <p className="mt-5 text-base leading-relaxed text-muted-foreground">
              S3 holds the markdown. Bedrock Knowledge Bases handles
              chunking, embedding, and retrieval against S3 Vectors. A
              FastMCP container on App Runner is the agent-facing surface.
              A Next.js admin on Amplify is the human-facing one. Every
              piece is in a single TypeScript CDK stack — one{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
                cdk deploy
              </code>{" "}
              brings everything up.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {STACK.map((s) => (
                <span
                  key={s}
                  className="rounded-md border bg-background px-2 py-1 font-mono text-[0.7rem] text-muted-foreground"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-xl border bg-card p-5 font-mono text-xs leading-relaxed text-card-foreground sm:p-6">
            <div className="text-muted-foreground"># 1. clone + deploy</div>
            <pre className="mt-1 whitespace-pre-wrap break-words">
{`git clone ${REPO_URL}.git
cd context101/cdk && npm install
npx cdk deploy -c seed=true`}
            </pre>

            <div className="mt-5 text-muted-foreground"># 2. point any MCP client</div>
            <pre className="mt-1 whitespace-pre-wrap break-words">
{`"context101": {
  "url": "https://<your-mcp>/mcp",
  "headers": {
    "Authorization": "Bearer <token>"
  }
}`}
            </pre>

            <Separator className="my-5" />
            <p className="text-muted-foreground">
              Full setup, including OAuth for connectors and the Amplify
              admin, in the README.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Honest scope ─────────────────────────────────────────────────── */

function ScopeSection() {
  return (
    <section className="border-y bg-muted/30">
      <div className="mx-auto w-full max-w-3xl px-4 py-20 sm:px-6 sm:py-24">
        <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
          Honest about scope.
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          The things we&apos;d rather you read here than be surprised by
          later.
        </p>

        <ul className="mt-7 space-y-5 text-sm leading-relaxed text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">
              Not enterprise yet.
            </span>{" "}
            No SSO, no SCIM, no fine-grained per-doc ACLs. Cognito for the web
            admin, a shared bearer token for the MCP. Roadmap item, not done.
          </li>
          <li>
            <span className="font-medium text-foreground">
              Not a turn-key SaaS.
            </span>{" "}
            You deploy it. The upside is that your data never leaves your AWS
            account; the cost is that initial setup needs an engineer for an
            afternoon.
          </li>
          <li>
            <span className="font-medium text-foreground">
              Embedding quality is solid, not bleeding-edge.
            </span>{" "}
            Titan v2 (1024-dim) is the default because it&apos;s native to
            Bedrock — swappable when retrieval quality becomes the bottleneck.
          </li>
          <li>
            <span className="font-medium text-foreground">
              PoC, not 1.0.
            </span>{" "}
            The architecture is working end-to-end and in daily use, but
            we&apos;re currently leveling it up — multi-org, multi-brain,
            per-user JWT on the MCP. Track the README and{" "}
            <Link href="/about" className="text-foreground underline-offset-4 hover:underline">
              About
            </Link>{" "}
            page for status.
          </li>
        </ul>
      </div>
    </section>
  );
}

/* ── Quick start ──────────────────────────────────────────────────── */

function QuickstartSection() {
  return (
    <section>
      <div className="mx-auto w-full max-w-3xl px-4 py-20 sm:px-6 sm:py-24">
        <div className="text-center">
          <BookOpen className="mx-auto mb-3 size-6 text-muted-foreground" />
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Five minutes from clone to first search.
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Prereqs: an AWS account, Node 20+, Docker, and Bedrock model
            access enabled for Titan and Claude Opus 4.7 in{" "}
            <code className="font-mono">us-east-1</code>.
          </p>
        </div>

        <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link href={REPO_URL} target="_blank" rel="noreferrer">
            <Button size="lg">
              <ExternalLink className="mr-1.5 h-4 w-4" />
              Clone the repo
            </Button>
          </Link>
          <Link href={REPO_URL} target="_blank" rel="noreferrer">
            <Button size="lg" variant="outline">
              Full walkthrough
              <ExternalLink className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ── Final CTA ────────────────────────────────────────────────────── */

function FinalCTA() {
  return (
    <section className="border-t bg-foreground text-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-6 px-4 py-14 sm:flex-row sm:px-6">
        <div>
          <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Stop pasting context into every AI.
          </h3>
          <p className="mt-2 max-w-xl text-sm text-background/70">
            Build it once. Let every agent your team uses retrieve from the
            same brain.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={REPO_URL} target="_blank" rel="noreferrer">
            <Button size="lg" variant="secondary">
              <Star className="mr-1.5 h-4 w-4" />
              Get started
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ── Footer ───────────────────────────────────────────────────────── */

function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:px-6">
        <div className="flex items-center gap-2">
          <span className="inline-block size-1.5 rounded-full bg-primary" />
          <span className="font-medium text-foreground">Context101</span>
          <span>· Open source</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/about" className="hover:text-foreground">
            About
          </Link>
          <Link
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground"
          >
            GitHub
          </Link>
          <Link href="/login?next=/knowledge" className="hover:text-foreground">
            Sign in
          </Link>
        </div>
      </div>
    </footer>
  );
}
