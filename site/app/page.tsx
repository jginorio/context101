import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  Brain,
  CheckCircle2,
  Cloud,
  Database,
  GitBranch,
  Inbox,
  LockKeyhole,
  MessageSquarePlus,
  Plug,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { ConnectionDiagram } from "@/components/connection-diagram";
import { Counter } from "@/components/counter";
import { FadeIn } from "@/components/fade-in";
import { TypingRotate } from "@/components/typing-rotate";
import { Button } from "@/components/ui/button";

const REPO_URL = "https://github.com/jginorio/context101";
const APP_DOCS_URL = `${REPO_URL}#setup`;

const features = [
  {
    title: "One shared context layer",
    body: "Teams write and approve knowledge once, then expose it through MCP to Cursor, Claude Desktop, Claude Code, Devin, and custom agents.",
    Icon: Brain,
  },
  {
    title: "Multiple isolated brains",
    body: "Create separate brains for teams, projects, or customers. Each brain has its own docs, sources, suggestions queue, and MCP bearer token.",
    Icon: Database,
  },
  {
    title: "Self-hosted in AWS",
    body: "The deployable app is CDK, S3, Bedrock Knowledge Bases, S3 Vectors, DynamoDB, Lambda, Amplify, and a FastMCP service.",
    Icon: Cloud,
  },
  {
    title: "Alpha by design",
    body: "Built from a real internal PoC. Useful today for trusted teams, but not hardened for hostile tenants or managed multi-tenant hosting.",
    Icon: ShieldCheck,
  },
];

const caveats = [
  "Trusted internal team model: signed-in users are admins, and per-brain bearer tokens can be revealed in the app.",
  "Connectors are useful but early. Google Workspace, Notion, and GitHub sync into markdown, with GitHub currently using a pasted PAT.",
  "AWS setup still has real prerequisites: us-east-1, Bedrock model access, Docker, CDK bootstrap, and provider OAuth setup for connectors.",
];

const faqs = [
  {
    question: "Why Titan embeddings instead of OpenAI embeddings?",
    answer:
      "Titan was the easiest fit for an AWS-first PoC: Bedrock Knowledge Bases can use it natively, which keeps deployment simple and avoids extra provider keys. There are likely better retrieval-quality options, and swapping embedding models is a reasonable future improvement.",
  },
  {
    question: "Why Cognito?",
    answer:
      "Same reason: it was the path of least resistance for a CDK-deployed AWS stack. Cognito is not the dream auth product, but keeping auth inside AWS made the PoC easier to ship and easier for self-hosters to reproduce. We are open to changing it later.",
  },
  {
    question: "Why so many AWS services?",
    answer:
      "Most infrastructure choices were made to make the stack easy to deploy from CDK, not because they are the only possible architecture. The bias was: one cloud account, managed services, minimal external setup, and no bespoke operations layer for the first version. Multi-brain support follows that model: one deployment can host multiple isolated brains.",
  },
  {
    question: "What inspired this?",
    answer:
      "The workflow takes inspiration from Devin's agent knowledge experience and from DeepWiki-style generated documentation. Context101 applies those ideas to shared team knowledge exposed through MCP, not just repository documentation.",
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <nav
        className="flex w-full items-center justify-between gap-4"
        aria-label="Main navigation"
      >
        <Link
          href="/"
          className="inline-flex min-w-0 items-center gap-2 font-bold tracking-[-0.02em]"
        >
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary shadow-[0_0_22px_rgba(196,138,66,0.4)]"
            aria-hidden
          />
          <span className="truncate">Context101</span>
        </Link>
        <Button asChild variant="outline" size="sm">
          <a href={APP_DOCS_URL}>
            Deploy the app
            <ArrowRight />
          </a>
        </Button>
      </nav>

      <section className="grid gap-9 py-16 sm:py-24 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
        <FadeIn>
          <h1 className="text-[clamp(48px,8vw,86px)] leading-[0.95] font-bold tracking-[-0.06em]">
            One brain.
            <br />
            <span className="text-primary">Every AI tool.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
            Context101 is a self-hosted MCP knowledge base for teams that want
            Cursor, Claude, Devin, and internal agents to retrieve from the same
            approved context. It is alpha software, designed to be deployed into
            your own AWS account.
          </p>
          <p className="mt-5 text-sm leading-7 text-muted-foreground">
            So now{" "}
            <TypingRotate
              className="font-semibold text-foreground"
              phrases={[
                "Cursor knows this.",
                "Claude Code knows this.",
                "Claude Desktop knows this.",
                "Devin knows this.",
                "your custom agent knows this.",
              ]}
            />
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild>
              <a href={REPO_URL}>
                View on GitHub
                <GitBranch />
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={APP_DOCS_URL}>
                Read deploy docs
                <ArrowRight />
              </a>
            </Button>
          </div>
        </FadeIn>

        <FadeIn
          className="self-end rounded-[28px] border border-border bg-card/90 p-6"
          delayMs={120}
        >
          <p className="mb-4 font-mono text-xs text-muted-foreground">
            Deployable app, not this homepage
          </p>
          <div className="grid gap-2.5">
            <div className="overflow-x-auto whitespace-pre rounded-2xl border border-border bg-[var(--code)] p-3.5 font-mono text-[13px] leading-6">
              git clone {REPO_URL}.git
            </div>
            <div className="overflow-x-auto whitespace-pre rounded-2xl border border-border bg-[var(--code)] p-3.5 font-mono text-[13px] leading-6">
              cd context101/cdk{"\n"}npm install
            </div>
            <div className="overflow-x-auto whitespace-pre rounded-2xl border border-border bg-[var(--code)] p-3.5 font-mono text-[13px] leading-6">
              ./deploy.sh --seed
            </div>
          </div>
        </FadeIn>
      </section>

      <section className="border-t border-border py-14">
        <FadeIn>
          <h2 className="text-[clamp(30px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.045em]">
            The website and app are separate.
          </h2>
          <p className="mt-3.5 max-w-3xl text-base leading-7 text-muted-foreground">
            This site explains the project. The deployable product lives in
            <code> web/</code> and starts directly in the authenticated app. That
            keeps self-hosted deployments focused on the knowledge base instead
            of shipping a marketing homepage to every internal team.
          </p>
        </FadeIn>
        <div className="mt-7 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(({ title, body, Icon }) => (
            <FadeIn
              className="rounded-[22px] border border-border bg-card p-5"
              key={title}
            >
              <Icon aria-hidden size={22} />
              <h3 className="mt-4 text-lg font-semibold tracking-[-0.02em]">
                {title}
              </h3>
              <p className="mt-2.5 text-sm leading-6 text-muted-foreground">
                {body}
              </p>
            </FadeIn>
          ))}
        </div>
      </section>

      <section className="border-t border-border py-14">
        <FadeIn>
          <h2 className="text-[clamp(30px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.045em]">
            Write once. Retrieve from everywhere.
          </h2>
          <p className="mt-3.5 max-w-3xl text-base leading-7 text-muted-foreground">
            The motion is the system: sources flow into one brain, and every MCP
            client reads from that same approved context.
          </p>
        </FadeIn>
        <FadeIn
          className="mt-7 overflow-x-auto overflow-y-hidden rounded-[30px] border border-border bg-[radial-gradient(circle_at_50%_50%,rgba(95,116,132,0.13),transparent_38%),color-mix(in_srgb,var(--card-2)_92%,transparent)] p-7"
          delayMs={100}
        >
          <ConnectionDiagram />
        </FadeIn>
      </section>

      <section className="border-t border-border py-14">
        <div className="grid gap-6">
          <FadeIn>
            <h2 className="text-[clamp(30px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.045em]">
              A generated wiki, not just raw search.
            </h2>
            <p className="mt-3.5 max-w-3xl text-base leading-7 text-muted-foreground">
              Context101 can synthesize the raw files in a brain into a
              readable wiki: topic pages, source citations, and architecture
              notes that agents can retrieve before falling back to raw docs.
              The goal is to give teammates a shared, reconciled view instead of
              a pile of disconnected chunks.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[22px] border border-border bg-card p-5">
                <Sparkles aria-hidden size={22} />
                <h3 className="mt-4 text-lg font-semibold tracking-[-0.02em]">
                  Reconciled pages
                </h3>
                <p className="mt-2.5 text-sm leading-6 text-muted-foreground">
                  The wiki generator groups related files into human-readable
                  pages with citations back to the source material.
                </p>
              </div>
              <div className="rounded-[22px] border border-border bg-card p-5">
                <RefreshCw aria-hidden size={22} />
                <h3 className="mt-4 text-lg font-semibold tracking-[-0.02em]">
                  Manual refresh
                </h3>
                <p className="mt-2.5 text-sm leading-6 text-muted-foreground">
                  Regeneration is intentionally operator-controlled today so
                  teams can manage Bedrock cost and review behavior as data
                  grows.
                </p>
              </div>
            </div>
          </FadeIn>

          <FadeIn delayMs={120}>
            <figure className="overflow-hidden rounded-[28px] border border-border bg-card">
              <Image
                src="/wiki-preview.png"
                alt="Context101 generated wiki page showing synthesized prose, source citations, a Mermaid diagram, and code wiki navigation."
                width={3024}
                height={1720}
                className="h-auto w-full"
                sizes="(min-width: 1024px) 520px, 100vw"
              />
            </figure>
            <div className="mt-4 rounded-[22px] border border-[color-mix(in_srgb,var(--accent)_28%,var(--line))] bg-[color-mix(in_srgb,var(--accent-soft)_78%,transparent)] p-5">
              <p className="font-mono text-xs text-muted-foreground">
                Current caveat
              </p>
              <h3 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">
                Tested with roughly 100 documents, not thousands.
              </h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                The current wiki flow was built for PoC-scale corpora. Once a
                brain has a lot more data, the generator needs better batching,
                incremental updates, source selection, and page-level caching.
                Search can still work at larger sizes, but the generated wiki is
                the part that needs more hardening.
              </p>
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-border py-14">
        <FadeIn>
          <h2 className="text-[clamp(30px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.045em]">
            Agents can suggest. Humans still decide.
          </h2>
          <p className="mt-3.5 max-w-3xl text-base leading-7 text-muted-foreground">
            Context101 is not just a place for humans to upload docs. MCP
            clients can propose new knowledge or improvements while they work,
            but those suggestions land in a review queue instead of writing
            directly into the brain.
          </p>
        </FadeIn>

        <FadeIn className="mt-7" delayMs={80}>
          <figure className="overflow-hidden rounded-[28px] border border-border bg-card">
            <Image
                src="/suggestions-review-preview.png"
              alt="Context101 suggestions review drawer showing an agent-proposed update with a side-by-side diff and approve or reject actions."
              width={3024}
              height={1720}
              className="h-auto w-full"
              sizes="(min-width: 1024px) 1120px, 100vw"
            />
          </figure>
        </FadeIn>

        <div className="mt-7 grid gap-3.5 md:grid-cols-3">
          <FadeIn className="rounded-[22px] border border-border bg-card p-5">
            <MessageSquarePlus aria-hidden size={22} />
            <h3 className="mt-4 text-lg font-semibold tracking-[-0.02em]">
              Propose from any MCP client
            </h3>
            <p className="mt-2.5 text-sm leading-6 text-muted-foreground">
              Cursor, Claude, or another agent can call{" "}
              <code>suggest_knowledge</code> when it discovers a missing fact,
              clearer explanation, or update worth preserving.
            </p>
          </FadeIn>

          <FadeIn
            className="rounded-[22px] border border-border bg-card p-5"
            delayMs={80}
          >
            <Inbox aria-hidden size={22} />
            <h3 className="mt-4 text-lg font-semibold tracking-[-0.02em]">
              Review before it lands
            </h3>
            <p className="mt-2.5 text-sm leading-6 text-muted-foreground">
              Suggestions appear in the web app with rationale, proposed
              content, and diffs for updates. Nothing becomes source material
              until a person accepts it.
            </p>
          </FadeIn>

          <FadeIn
            className="rounded-[22px] border border-border bg-card p-5"
            delayMs={160}
          >
            <CheckCircle2 aria-hidden size={22} />
            <h3 className="mt-4 text-lg font-semibold tracking-[-0.02em]">
              Accepted changes re-index
            </h3>
            <p className="mt-2.5 text-sm leading-6 text-muted-foreground">
              Approved suggestions write back to S3, trigger ingestion, and
              become part of future search and wiki generation for that brain.
            </p>
          </FadeIn>
        </div>

        <FadeIn className="mt-7 rounded-[22px] border border-[color-mix(in_srgb,var(--accent)_28%,var(--line))] bg-[color-mix(in_srgb,var(--accent-soft)_78%,transparent)] p-5">
          <strong>External-source caveat:</strong> if a suggestion improves
          content that originally came from Google Docs, Notion, GitHub, or
          another connector, Context101 does not push that fix back to the
          original source of truth yet. Today you either update the source
          manually or accept the suggestion into Context101&apos;s stored markdown.
          Source-level writeback is a follow-up.
        </FadeIn>
      </section>

      <section className="border-t border-border py-14 text-center">
        <FadeIn>
          <h2 className="text-[clamp(30px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.045em]">
            Small enough to try, real enough to use.
          </h2>
        </FadeIn>
        <div className="mt-7 grid gap-3.5 md:grid-cols-3">
          <FadeIn className="rounded-3xl border border-border bg-card px-4 py-6">
            <strong className="block text-[clamp(38px,6vw,58px)] leading-[0.95] font-bold tracking-[-0.055em]">
              <Counter to={5} />+
            </strong>
            <span className="mt-3 block text-[13px] leading-5 text-muted-foreground">
              MCP clients
            </span>
          </FadeIn>
          <FadeIn className="rounded-3xl border border-border bg-card px-4 py-6" delayMs={80}>
            <strong className="block text-[clamp(38px,6vw,58px)] leading-[0.95] font-bold tracking-[-0.055em]">
              $<Counter to={5} />-<Counter to={15} />
            </strong>
            <span className="mt-3 block text-[13px] leading-5 text-muted-foreground">
              monthly AWS cost at PoC scale
            </span>
          </FadeIn>
          <FadeIn className="rounded-3xl border border-border bg-card px-4 py-6" delayMs={160}>
            <strong className="block text-[clamp(38px,6vw,58px)] leading-[0.95] font-bold tracking-[-0.055em]">
              <Counter to={1} />
            </strong>
            <span className="mt-3 block text-[13px] leading-5 text-muted-foreground">
              deployable internal app
            </span>
          </FadeIn>
        </div>
      </section>

      <section id="caveats" className="border-t border-border py-14">
        <FadeIn>
          <h2 className="text-[clamp(30px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.045em]">
            Useful now, honest about limits.
          </h2>
          <p className="mt-3.5 max-w-3xl text-base leading-7 text-muted-foreground">
            Context101 started as a PoC for an internal company problem. The
            goal of open sourcing it is to let other teams deploy and evolve it
            internally, not to claim it is a finished production SaaS.
          </p>
        </FadeIn>
        <div className="mt-7 grid gap-3.5 md:grid-cols-3">
          {caveats.map((body, index) => (
            <FadeIn
              className="rounded-[22px] border border-border bg-card p-5"
              key={body}
              delayMs={index * 80}
            >
              {index === 0 ? (
                <LockKeyhole aria-hidden size={22} />
              ) : index === 1 ? (
                <Plug aria-hidden size={22} />
              ) : (
                <Cloud aria-hidden size={22} />
              )}
              <h3 className="mt-4 text-lg font-semibold tracking-[-0.02em]">
                {["Auth model", "Connectors", "AWS caveats"][index]}
              </h3>
              <p className="mt-2.5 text-sm leading-6 text-muted-foreground">
                {body}
              </p>
            </FadeIn>
          ))}
        </div>
        <FadeIn className="mt-7 rounded-[22px] border border-[color-mix(in_srgb,var(--accent)_28%,var(--line))] bg-[color-mix(in_srgb,var(--accent-soft)_86%,transparent)] p-5">
          <strong>Future path:</strong> managed hosting can come later, after
          per-user auth, per-brain RBAC, audit logs, connector credential
          isolation, billing boundaries, and operational runbooks exist.
        </FadeIn>
      </section>

      <section className="border-t border-border py-14">
        <FadeIn>
          <h2 className="text-[clamp(30px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.045em]">
            Good to know.
          </h2>
          <p className="mt-3.5 max-w-3xl text-base leading-7 text-muted-foreground">
            A few choices are pragmatic rather than perfect. Context101 started
            as a PoC, so the first version optimizes for easy self-hosted
            deployment over architectural purity.
          </p>
        </FadeIn>

        <div className="mt-7 grid gap-3.5 md:grid-cols-2">
          {faqs.map((item, index) => (
            <FadeIn
              className="rounded-[22px] border border-border bg-card p-5"
              key={item.question}
              delayMs={index * 60}
            >
              <h3 className="text-lg font-semibold tracking-[-0.02em]">
                {item.question}
              </h3>
              <p className="mt-2.5 text-sm leading-6 text-muted-foreground">
                {item.answer}
              </p>
              {item.question === "What inspired this?" ? (
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  Credit to{" "}
                  <a
                    href="https://devin.ai"
                    className="text-foreground underline underline-offset-4"
                  >
                    Devin
                  </a>{" "}
                  and{" "}
                  <a
                    href="https://github.com/AsyncFuncAI/deepwiki-open"
                    className="text-foreground underline underline-offset-4"
                  >
                    DeepWiki Open
                  </a>
                  .
                </p>
              ) : null}
            </FadeIn>
          ))}
        </div>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-6 text-[13px] text-muted-foreground">
        <span>Context101 alpha. Self-hosted first.</span>
        <span>Marketing site in <code>site/</code>; deployable app in <code>web/</code>.</span>
      </footer>
    </main>
  );
}
