import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Brain,
  Cloud,
  ExternalLink,
  Layers,
  Plug,
  ShieldCheck,
  Star,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { ConnectionDiagram } from "@/components/landing/connection-diagram";
import { Counter } from "@/components/landing/counter";
import { FadeIn } from "@/components/landing/fade-in";
import { LogoCloud } from "@/components/landing/logo-cloud";
import { TypingRotate } from "@/components/landing/typing-rotate";

export const metadata: Metadata = {
  title: "Context101: one brain, every AI tool",
  description:
    "A self-hosted, MCP-native knowledge base. Write team knowledge once; Cursor, Claude Code, Claude Desktop, Devin, and any MCP-compatible agent retrieve from it.",
};

const REPO_URL = "https://github.com/jginorio/context101";

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col">
      <SiteHeader />
      <Hero />
      <LogoCloudStrip />
      <ProblemSection />
      <DiagramSection />
      <FeaturesSection />
      <AnatomySection />
      <StatsSection />
      <ArchitectureSection />
      <ScopeSection />
      <FinalCTA />
      <SiteFooter />
    </main>
  );
}

/* ── Header ───────────────────────────────────────────────────────── */

function SiteHeader() {
  return (
    <header className="pointer-events-none sticky top-3 z-30 flex justify-center px-3 sm:top-4">
      <div className="pointer-events-auto flex h-12 w-full max-w-3xl items-center justify-between gap-2 rounded-full border bg-background/85 px-3 shadow-sm backdrop-blur-md supports-[backdrop-filter]:bg-background/70 sm:h-13 sm:px-4">
        <Link href="/" className="flex items-center gap-2 pl-1">
          <span className="inline-block size-2 rounded-full bg-[var(--notio-orange)]" />
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
            <Button size="sm" className="rounded-full">
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
      <div
        aria-hidden
        className="notio-radial-hero absolute inset-0 -z-10"
      />
      <div className="mx-auto w-full max-w-6xl px-4 pt-24 pb-12 sm:px-6 sm:pt-32 sm:pb-20">
        <div className="mx-auto max-w-3xl text-center">
          <div
            className="notio-rise mb-6 inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-xs text-muted-foreground backdrop-blur-sm"
            style={{ "--notio-delay": "0ms" } as React.CSSProperties}
          >
            <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
            Open source · MCP-native · Self-hosted on AWS
          </div>

          <h1
            className="notio-display notio-rise text-balance text-5xl leading-[1.05] sm:text-7xl"
            style={{ "--notio-delay": "80ms" } as React.CSSProperties}
          >
            One brain.
            <br />
            <span className="notio-accent">Every AI tool.</span>
          </h1>

          <p
            className="notio-rise mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg"
            style={{ "--notio-delay": "200ms" } as React.CSSProperties}
          >
            A self-hosted knowledge base your team writes into once. Every
            MCP-compatible agent retrieves from the same brain. No per-tool
            integrations, no copy-pasted context.
          </p>

          <div
            className="notio-rise mx-auto mt-7 flex max-w-md flex-col items-center justify-center gap-2 text-sm text-muted-foreground sm:flex-row sm:gap-3"
            style={{ "--notio-delay": "320ms" } as React.CSSProperties}
          >
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

          <div
            className="notio-rise mt-10 flex flex-wrap items-center justify-center gap-3"
            style={{ "--notio-delay": "440ms" } as React.CSSProperties}
          >
            <Link href={REPO_URL} target="_blank" rel="noreferrer">
              <Button size="lg" className="rounded-full">
                <Star className="mr-1.5 h-4 w-4" />
                View on GitHub
              </Button>
            </Link>
            <Link href={REPO_URL} target="_blank" rel="noreferrer">
              <Button size="lg" variant="outline" className="rounded-full">
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

/* ── Logo cloud strip ─────────────────────────────────────────────── */

function LogoCloudStrip() {
  return (
    <section className="border-y">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <FadeIn>
          <p className="mb-7 text-center text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Works with the agents you already use
          </p>
          <LogoCloud />
        </FadeIn>
      </div>
    </section>
  );
}

/* ── §01 The problem ──────────────────────────────────────────────── */

function ProblemSection() {
  return (
    <section>
      <div className="mx-auto w-full max-w-3xl px-4 py-20 sm:px-6 sm:py-28">
        <FadeIn>
          <SectionLabel n="01">The problem</SectionLabel>
          <h2 className="notio-display mt-3 text-balance text-4xl leading-[1.1] sm:text-5xl">
            Knowledge gets stuck in chat sessions.
          </h2>
          <p className="mt-6 text-base leading-relaxed text-muted-foreground sm:text-lg">
            Every teammate&apos;s AI only knows what that person has told it.
            The analyst&apos;s findings stay inside their Claude Desktop. The
            PM asks their own AI and gets a generic answer. The engineer in
            Cursor restarts from zero context.
          </p>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
            Decisions get made on fragmented memory, and the chain of
            understanding breaks at every handoff.
          </p>
        </FadeIn>
      </div>
    </section>
  );
}

/* ── §02 The protocol (diagram) ───────────────────────────────────── */

function DiagramSection() {
  return (
    <section className="border-y bg-muted/30">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <FadeIn className="mx-auto mb-12 max-w-2xl text-center sm:mb-16">
          <SectionLabel n="02">The protocol</SectionLabel>
          <h2 className="notio-display mt-3 text-balance text-4xl leading-[1.1] sm:text-5xl">
            Write once. Retrieve from everywhere.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground">
            MCP is the open protocol Anthropic defined for exactly this. Any
            MCP-compatible client plugs into the same brain with zero custom
            work. No SDK lock-in, no per-tool wiring.
          </p>
        </FadeIn>

        <FadeIn className="mx-auto max-w-5xl">
          <div className="overflow-hidden rounded-3xl border bg-card p-4 shadow-sm sm:rounded-[2rem] sm:p-8">
            <ConnectionDiagram />
          </div>
        </FadeIn>

        <p className="mx-auto mt-10 max-w-xl text-center text-sm text-muted-foreground">
          One source of truth. Many consumers. The brain lives in your AWS
          account, not someone else&apos;s SaaS.
        </p>
      </div>
    </section>
  );
}

/* ── §03 Design decisions ─────────────────────────────────────────── */

const FEATURES = [
  {
    Icon: Layers,
    title: "Reconciled answers, not duplicate chunks",
    body: "A scheduled Opus job synthesizes the raw corpus into a canonical wiki with citations. Search returns the reconciled version; raw originals are one call away when you need to verify.",
  },
  {
    Icon: ShieldCheck,
    title: "Agents propose. Humans approve.",
    body: "Agents can suggest new knowledge as they work via MCP. Proposals land in a review queue; nothing reaches the brain until you accept it in the UI.",
  },
  {
    Icon: Cloud,
    title: "Your AWS account. No per-seat pricing.",
    body: "Runs on managed AWS primitives at ~$5-15/mo at PoC scale. Cost scales with content, not headcount. Data never leaves your perimeter.",
  },
  {
    Icon: Plug,
    title: "Connectors that don't lock you in",
    body: "Google Sheets, Docs, Slides, Notion, and GitHub all re-sync into the same retrieval surface every 6h. Source data stays in its home tool.",
  },
  {
    Icon: Brain,
    title: "Parallel brains, one MCP service",
    body: "Create as many brains as you want from the /brains page — each isolated (own S3 bucket, KB, vector index, tables, bearer token). One App Runner service serves all of them; clients pick a brain via /brain/<id>/mcp or the URL switcher in the admin UI.",
  },
];

function FeaturesSection() {
  return (
    <section>
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <FadeIn className="mx-auto mb-12 max-w-2xl text-center sm:mb-16">
          <SectionLabel n="03">Design decisions</SectionLabel>
          <h2 className="notio-display mt-3 text-balance text-4xl leading-[1.1] sm:text-5xl">
            What you actually get.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground">
            Five choices that make Context101 distinct from a vanilla RAG
            server.
          </p>
        </FadeIn>

        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map(({ Icon, title, body }) => (
            <FadeIn
              key={title}
              className="group rounded-3xl border bg-card p-6 transition-colors hover:border-[var(--notio-orange-soft)]/40 sm:p-7"
            >
              <div className="mb-4 inline-flex size-10 items-center justify-center rounded-2xl bg-[var(--notio-orange)]/8 text-[var(--notio-orange)] ring-1 ring-[var(--notio-orange)]/20 dark:text-[var(--notio-orange-soft)] dark:ring-[var(--notio-orange-soft)]/30">
                <Icon className="size-5" />
              </div>
              <h3 className="notio-display text-lg leading-snug sm:text-xl">
                {title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {body}
              </p>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── §04 Anatomy of an answer ─────────────────────────────────────── */

const ANATOMY_CALLOUTS: Array<{ title: string; body: string }> = [
  {
    title: "Two-tier sidebar",
    body: "Team wiki on top, per-repo code wikis below. Each connected GitHub repo gets its own deepwiki-style synthesis.",
  },
  {
    title: "Synthesized prose, sourced",
    body: "Every claim ends with a Sources line linking back to the raw markdown the model read.",
  },
  {
    title: "Auto-generated diagrams",
    body: "Mermaid blocks fall out of the synthesis when relationships in the corpus are structural enough to draw.",
  },
  {
    title: "Honest indexing state",
    body: "Last-indexed timestamp, source count, and a manual refresh button. No hidden caches.",
  },
];

function AnatomySection() {
  return (
    <section className="border-y bg-muted/30">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <FadeIn className="mx-auto mb-10 max-w-2xl text-center sm:mb-14">
          <SectionLabel n="04">Anatomy of an answer</SectionLabel>
          <h2 className="notio-display mt-3 text-balance text-4xl leading-[1.1] sm:text-5xl">
            What the brain actually looks like.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground">
            Every retrieval lands on a synthesized wiki page with citations
            back to raw sources. Here is a page from a running deployment.
          </p>
        </FadeIn>

        <FadeIn as="figure" className="mx-auto max-w-5xl">
          <div className="overflow-hidden rounded-3xl border bg-card shadow-sm sm:rounded-[2rem]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/wiki-preview.png"
              alt="A Context101 wiki page showing synthesized prose with linked source citations, an auto-generated Mermaid diagram, a sidebar with team-wiki and per-repo code-wiki sections, and a refresh-status panel with last-indexed timestamp."
              width={3024}
              height={1720}
              loading="lazy"
              decoding="async"
              className="block h-auto w-full"
            />
          </div>
        </FadeIn>

        <FadeIn delayMs={120}>
          <ol className="mx-auto mt-10 grid max-w-5xl gap-6 text-sm sm:mt-12 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
            {ANATOMY_CALLOUTS.map(({ title, body }, i) => (
              <li key={title} className="grid gap-2">
                <span
                  aria-hidden
                  className="font-mono text-xs tabular-nums text-muted-foreground"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p className="font-medium text-foreground">{title}</p>
                <p className="leading-relaxed text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
        </FadeIn>
      </div>
    </section>
  );
}

/* ── Stats ────────────────────────────────────────────────────────── */

function StatsSection() {
  return (
    <section>
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <FadeIn className="mx-auto mb-12 max-w-2xl text-center sm:mb-16">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            By the numbers
          </p>
          <h2 className="notio-display mt-3 text-balance text-4xl leading-[1.1] sm:text-5xl">
            The proof is in the receipts.
          </h2>
        </FadeIn>

        <FadeIn>
          <dl className="grid divide-y rounded-3xl border bg-card sm:grid-cols-4 sm:divide-x sm:divide-y-0">
            <Stat
              value={
                <>
                  <span className="text-muted-foreground/70">~$</span>
                  <Counter to={5} />
                  <span className="text-muted-foreground/70">-</span>
                  <Counter to={15} />
                </>
              }
              unit="/ month"
              label="AWS cost at PoC scale"
            />
            <Stat
              value={<Counter to={1} />}
              unit="cdk deploy"
              label="From clone to a live MCP URL"
            />
            <Stat
              value={<Counter to={5} suffix="+" />}
              unit="MCP clients"
              label="Cursor, Claude Code, Desktop, Devin, custom"
            />
            <Stat
              value={<Counter to={0} />}
              unit="lock-in"
              label="Self-hosted in your own AWS account"
            />
          </dl>
        </FadeIn>
      </div>
    </section>
  );
}

function Stat({
  value,
  unit,
  label,
}: {
  value: React.ReactNode;
  unit: string;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-2 px-6 py-8 text-center sm:px-4 sm:py-10">
      <div className="notio-display text-4xl leading-none sm:text-5xl">
        {value}
      </div>
      <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        {unit}
      </div>
      <p className="mx-auto mt-1 max-w-[14rem] text-sm leading-relaxed text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

/* ── §05 Architecture ─────────────────────────────────────────────── */

const STACK_ROWS: Array<{ name: string; role: string }> = [
  {
    name: "S3",
    role: "Markdown docs, versioned. The runtime source of truth.",
  },
  {
    name: "Bedrock KB",
    role: "Chunks, embeds, retrieves. Auto-ingests on every S3 PutObject.",
  },
  {
    name: "S3 Vectors",
    role: "Cosine top-K over 1024-dim chunk vectors. Cheapest store in AWS.",
  },
  {
    name: "Titan embed v2",
    role: "Default embedding model, native to Bedrock. Swappable later.",
  },
  {
    name: "FastMCP",
    role: "Python MCP server on App Runner. Bearer-token auth, stable TLS URL.",
  },
  {
    name: "Opus 4.7",
    role: "Reconciles raw corpus into a canonical wiki. Improve-with-AI button.",
  },
  {
    name: "Next.js 16",
    role: "Admin UI on Amplify Hosting. Cognito auth, CRUD over the same S3.",
  },
  {
    name: "AWS CDK",
    role: "Whole stack as one TypeScript file. One `cdk deploy` brings it up.",
  },
];

function ArchitectureSection() {
  return (
    <section className="border-y bg-muted/30">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <FadeIn className="mb-12 max-w-2xl sm:mb-16">
          <SectionLabel n="05">Architecture</SectionLabel>
          <h2 className="notio-display mt-3 text-balance text-4xl leading-[1.1] sm:text-5xl">
            Boring managed primitives, wired up by CDK.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground">
            Nothing exotic. Each layer is one AWS primitive you can read about
            in the docs, picked because it had the smallest footprint for the
            job.
          </p>
        </FadeIn>

        <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr] lg:gap-8">
          <div className="overflow-hidden rounded-3xl border bg-card">
            <div className="border-b bg-muted/40 px-5 py-3 font-mono text-xs uppercase tracking-wider text-muted-foreground">
              {"// The stack"}
            </div>
            <dl className="divide-y">
              {STACK_ROWS.map(({ name, role }) => (
                <div
                  key={name}
                  className="grid gap-1 px-5 py-3.5 sm:grid-cols-[9rem_1fr] sm:items-baseline sm:gap-5"
                >
                  <dt className="font-mono text-sm font-medium text-card-foreground">
                    {name}
                  </dt>
                  <dd className="text-sm leading-relaxed text-muted-foreground">
                    {role}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-3xl border bg-card p-6 font-mono text-xs leading-relaxed text-card-foreground sm:p-7">
            <div className="text-muted-foreground"># 1. clone + deploy</div>
            <pre className="mt-1 whitespace-pre-wrap break-words">
{`git clone ${REPO_URL}.git
cd context101/cdk && npm install
npx cdk deploy -c seed=true`}
            </pre>

            <div className="mt-5 text-muted-foreground">
              # 2. point any MCP client
            </div>
            <pre className="mt-1 whitespace-pre-wrap break-words">
{`"context101": {
  "url": "https://<your-mcp>/mcp",
  "headers": {
    "Authorization": "Bearer <token>"
  }
}`}
            </pre>

            <p className="mt-6 text-muted-foreground">
              Full setup, including OAuth for connectors and the Amplify
              admin, in the README.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── §06 Scope ────────────────────────────────────────────────────── */

const NOT_INCLUDED: Array<{ tag: string; title: string; body: React.ReactNode }> = [
  {
    tag: "AUTH",
    title: "No SSO, no SCIM, no per-doc ACLs.",
    body: "Cognito for the web admin, a shared bearer token for the MCP. Roadmap item, not done.",
  },
  {
    tag: "HOSTING",
    title: "Not a turn-key SaaS.",
    body: "You deploy it. The upside is your data never leaves your AWS account; the cost is half an afternoon of engineer setup the first time.",
  },
  {
    tag: "MODELS",
    title: "Embedding quality is solid, not bleeding-edge.",
    body: "Titan v2 (1024-dim) is the default because it's native to Bedrock. Swappable when retrieval quality becomes the bottleneck.",
  },
  {
    tag: "SCALE",
    title: "We haven't run this at large-corpus sizes.",
    body: (
      <>
        Bedrock KB + S3 Vectors scale to millions of chunks in principle.
        The bottleneck we know about is the wiki generator: it feeds the
        whole raw corpus into Opus to plan the structure, then full source
        files per page — prompt cost grows roughly linearly with documents.
        We&apos;ve exercised it on a few hundred docs per brain; behaviour
        beyond a few thousand isn&apos;t something we can vouch for yet.
        If you push past that, please tell us what broke.
      </>
    ),
  },
  {
    tag: "MULTI-BRAIN",
    title: "Brains are fresh.",
    body: (
      <>
        The /brains page provisions a fully isolated brain (own S3 bucket,
        Bedrock KB, vector index, tables, bearer token) in 30–60s. It
        works, but it&apos;s the newest surface in the codebase. Cross-brain
        analytics, brain-level audit trails, and import/export between
        brains are not built yet. Start with one brain; spin a second to
        feel out the workflow before betting on it.
      </>
    ),
  },
  {
    tag: "TIMELINE",
    title: "PoC, not 1.0.",
    body: (
      <>
        The architecture is in daily use end-to-end, and multi-brain just
        landed. What&apos;s still ahead: per-user JWT on the MCP (replacing
        the shared bearer per brain), per-doc ACLs, and a Notion / GitHub
        OAuth migration off PATs. Track the README and{" "}
        <Link
          href="/about"
          className="text-foreground underline-offset-4 hover:underline"
        >
          About
        </Link>{" "}
        page for what&apos;s actually shipped.
      </>
    ),
  },
];

function ScopeSection() {
  return (
    <section>
      <div className="mx-auto w-full max-w-3xl px-4 py-20 sm:px-6 sm:py-24">
        <FadeIn className="mb-10">
          <SectionLabel n="06">Scope</SectionLabel>
          <h2 className="notio-display mt-3 text-balance text-4xl leading-[1.1] sm:text-5xl">
            What&apos;s not in the box.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground">
            The things we&apos;d rather you read here than be surprised by
            later.
          </p>
        </FadeIn>

        <div className="overflow-hidden rounded-3xl border bg-card">
          <div className="border-b bg-muted/40 px-5 py-3 font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {"// Not included"}
          </div>
          <ul className="divide-y">
            {NOT_INCLUDED.map(({ tag, title, body }) => (
              <li
                key={tag}
                className="grid gap-2 px-5 py-5 sm:grid-cols-[5.5rem_1fr] sm:gap-5"
              >
                <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground sm:pt-1">
                  {tag}
                </span>
                <div>
                  <p className="text-sm font-medium text-card-foreground">
                    {title}
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ── §07 Get started (final) ──────────────────────────────────────── */

function FinalCTA() {
  return (
    <section className="relative overflow-hidden border-t">
      <div
        aria-hidden
        className="notio-radial-footer absolute inset-0 -z-10"
      />
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-end lg:gap-16">
          <FadeIn>
            <SectionLabel n="07">Get started</SectionLabel>
            <h2 className="notio-display mt-3 text-balance text-4xl leading-[1.1] sm:text-5xl">
              Five minutes from clone to first search.
            </h2>
            <p className="mt-5 text-base leading-relaxed text-muted-foreground">
              Prereqs: an AWS account, Node 20+, Docker, and Bedrock model
              access enabled for Titan and Claude Opus 4.7 in{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
                us-east-1
              </code>
              .
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href={REPO_URL} target="_blank" rel="noreferrer">
                <Button size="lg" className="rounded-full">
                  <Star className="mr-1.5 h-4 w-4" />
                  View on GitHub
                </Button>
              </Link>
              <Link href={REPO_URL} target="_blank" rel="noreferrer">
                <Button size="lg" variant="outline" className="rounded-full">
                  Full walkthrough
                  <ExternalLink className="ml-1 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </FadeIn>

          <div className="rounded-3xl border bg-card p-6 font-mono text-xs leading-relaxed text-card-foreground shadow-sm sm:p-7">
            <div className="text-muted-foreground"># clone</div>
            <pre className="mt-1 whitespace-pre-wrap break-words">
{`git clone ${REPO_URL}.git
cd context101`}
            </pre>
            <div className="mt-5 text-muted-foreground"># deploy</div>
            <pre className="mt-1 whitespace-pre-wrap break-words">
{`cd cdk && npm install
npx cdk deploy -c seed=true`}
            </pre>
            <p className="mt-6 text-muted-foreground">
              Auto-ingest indexes the seed in ~1 min. After that,{" "}
              <code className="font-mono">search_knowledge</code> is live for
              every MCP client you point at it.
            </p>
          </div>
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
          <span className="inline-block size-1.5 rounded-full bg-[var(--notio-orange)]" />
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

/* ── Section label (shared) ───────────────────────────────────────── */

function SectionLabel({
  n,
  children,
}: {
  n: string;
  children: React.ReactNode;
}) {
  return (
    <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
      <span aria-hidden>§{n}</span>{" "}
      <span className="sr-only">Section {n}.</span>
      {children}
    </p>
  );
}
