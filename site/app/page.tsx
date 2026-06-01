import Link from "next/link";
import Image from "next/image";
import {
  Brain,
  Building2,
  CheckCircle2,
  Cloud,
  Database,
  Inbox,
  KeyRound,
  LockKeyhole,
  MessageSquarePlus,
  Plug,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserPlus,
  Users,
} from "lucide-react";
import { ConnectionDiagram } from "@/components/connection-diagram";
import { Counter } from "@/components/counter";
import { FadeIn } from "@/components/fade-in";
import { ProviderMarquee } from "@/components/provider-logos";
import { GithubLogo, STACK_GROUPS } from "@/components/stack-logos";
import { TypingRotate } from "@/components/typing-rotate";
import { Button } from "@/components/ui/button";
import {
  AnimatedSpan,
  Terminal,
  TypingAnimation,
} from "@/components/ui/terminal";

const REPO_URL = "https://github.com/jginorio/context101";

const features = [
  {
    title: "One shared context layer",
    body: "Teams write and approve knowledge once, then expose it through MCP to Cursor, Claude Desktop, Claude Code, Devin, and custom agents.",
    Icon: Brain,
  },
  {
    title: "Organizations & roles",
    body: "Real multi-tenant orgs with owners, admins, and members. Invite teammates, manage roles, remove access, and reset member passwords from the app.",
    Icon: Users,
  },
  {
    title: "Multiple isolated brains",
    body: "Separate brains for teams, projects, or customers — each with its own docs, sources, suggestions queue, model config, and MCP bearer token.",
    Icon: Database,
  },
  {
    title: "Bring your own model",
    body: "Generate wikis with Amazon Bedrock, or your own key for Claude, GPT, Gemini, or Grok. Keys are stored encrypted in AWS Secrets Manager, never the database.",
    Icon: KeyRound,
  },
];

const caveats = [
  "Org-based access with owner/admin/member roles, email invites, and instant session revocation on removal. Still alpha: per-brain MCP tokens can be revealed in-app, and there's no SSO or email verification yet.",
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
    question: "Why Better Auth?",
    answer:
      "The first PoC used Cognito because it was easiest inside AWS. For the open-source SaaS path, Better Auth makes more sense: auth and organizations live in the same Postgres control plane self-hosters already deploy.",
  },
  {
    question: "How does team access work?",
    answer:
      "Each organization has owners, admins, and members. Admins invite teammates by email, change roles, remove members (which revokes their sessions immediately), and can reset a member's password. Users can belong to multiple orgs and switch between them from a workspace picker at sign-in.",
  },
  {
    question: "Can I use my own LLM provider?",
    answer:
      "Yes. Wiki generation runs on Amazon Bedrock out of the box, or you can bring your own API key for Anthropic, OpenAI, Google Gemini, or xAI Grok — chosen per brain. Keys are validated live and stored in AWS Secrets Manager, never in the database.",
  },
  {
    question: "Why so many AWS services?",
    answer:
      "Most infrastructure choices were made to make the stack easy to deploy from CDK, not because they are the only possible architecture. The bias was: one cloud account, managed services, minimal external setup, and no bespoke operations layer for the first version. The control plane is moving to Postgres so Neon, Supabase, RDS, Aurora, and local Postgres are all realistic options.",
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
            className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary shadow-[0_0_22px_rgba(217,70,239,0.45)]"
            aria-hidden
          />
          <span className="truncate">Context101</span>
        </Link>
        <Button asChild variant="outline" size="sm">
          <a href={REPO_URL}>
            <GithubLogo className="size-4" />
            View on GitHub
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
            Context101 is an MCP knowledge base for teams that want Cursor,
            Claude, Devin, and internal agents to retrieve from the same
            approved context. It is open-source alpha software: self-hostable
            today, with a hosted app path emerging at app.context101.dev.
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
          <div className="mt-6 space-y-2.5">
            {STACK_GROUPS.map(({ label, items }) => (
              <div
                key={label}
                className="flex flex-wrap items-center gap-x-2.5 gap-y-2"
              >
                <span className="text-xs font-medium text-muted-foreground/70">
                  {label}
                </span>
                {items.map(({ name, Logo, href }) => {
                  const inner = (
                    <>
                      <Logo className="h-3.5 w-3.5 shrink-0" />
                      {name}
                    </>
                  );
                  const cls =
                    "inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--accent)_16%,var(--line))] bg-[color-mix(in_srgb,var(--accent-soft)_55%,var(--card))] px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-[color-mix(in_srgb,var(--accent)_28%,var(--line))] hover:text-foreground";
                  return href ? (
                    <a
                      key={name}
                      className={cls}
                      href={href}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {inner}
                    </a>
                  ) : (
                    <span key={name} className={cls}>
                      {inner}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </FadeIn>

        <FadeIn className="self-end" delayMs={120}>
          <Terminal>
            <TypingAnimation>{`$ git clone ${REPO_URL}.git`}</TypingAnimation>
            <AnimatedSpan className="text-emerald-400">
              ✔ Cloned context101
            </AnimatedSpan>
            <TypingAnimation>{`$ cd context101/cdk && npm install`}</TypingAnimation>
            <AnimatedSpan className="text-emerald-400">
              ✔ Dependencies installed
            </AnimatedSpan>
            <TypingAnimation>{`$ ./deploy.sh --seed`}</TypingAnimation>
            <AnimatedSpan className="text-emerald-400">
              ✔ Brain provisioned · MCP endpoint live
            </AnimatedSpan>
            <AnimatedSpan className="text-muted-foreground">
              ℹ Open the app and sign in to start writing knowledge.
            </AnimatedSpan>
          </Terminal>
        </FadeIn>
      </section>

      <section className="border-t section-divider py-14">
        <FadeIn>
          <h2 className="text-[clamp(30px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.045em]">
            The website and app are separate.
          </h2>
          <p className="mt-3.5 max-w-3xl text-base leading-7 text-muted-foreground">
            This site explains the project. The product app lives in{" "}
            <code> web/</code> for self-hosted deployments, and the hosted app
            is intended to live separately at <code>app.context101.dev</code>.
            That keeps the marketing surface separate from the private knowledge
            app.
          </p>
        </FadeIn>
        <div className="mt-7 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(({ title, body, Icon }) => (
            <FadeIn
              className="surface-card p-5"
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

      <section className="border-t section-divider py-14">
        <FadeIn>
          <h2 className="text-[clamp(30px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.045em]">
            Built for teams, with real access control.
          </h2>
          <p className="mt-3.5 max-w-3xl text-base leading-7 text-muted-foreground">
            Context101 is organized around organizations, not just logins.
            Invite teammates, assign roles, switch between the orgs you belong
            to, and keep each org&apos;s brains fully isolated — all on a Better
            Auth + Postgres control plane you can self-host.
          </p>
        </FadeIn>
        <div className="mt-7 grid gap-3.5 md:grid-cols-3">
          <FadeIn className="surface-card p-5">
            <UserPlus aria-hidden size={22} />
            <h3 className="mt-4 text-lg font-semibold tracking-[-0.02em]">
              Invite & onboard
            </h3>
            <p className="mt-2.5 text-sm leading-6 text-muted-foreground">
              Invite teammates by email and share an accept link. People without
              an account can create one straight from the invite — no separate
              signup step, and the email is locked to the one you invited.
            </p>
          </FadeIn>
          <FadeIn
            className="surface-card p-5"
            delayMs={80}
          >
            <ShieldCheck aria-hidden size={22} />
            <h3 className="mt-4 text-lg font-semibold tracking-[-0.02em]">
              Roles & access
            </h3>
            <p className="mt-2.5 text-sm leading-6 text-muted-foreground">
              Owners and admins manage members and change roles. Removing a
              member revokes their sessions immediately, and admins can reset a
              locked-out teammate&apos;s password from the app.
            </p>
          </FadeIn>
          <FadeIn
            className="surface-card p-5"
            delayMs={160}
          >
            <Building2 aria-hidden size={22} />
            <h3 className="mt-4 text-lg font-semibold tracking-[-0.02em]">
              Multiple workspaces
            </h3>
            <p className="mt-2.5 text-sm leading-6 text-muted-foreground">
              Belong to more than one org? Pick a workspace at sign-in from a
              simple grid, spin up new orgs on the fly, and switch between them
              anytime.
            </p>
          </FadeIn>
        </div>
      </section>

      <section className="border-t section-divider py-14">
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
          className="mt-7 overflow-x-auto overflow-y-hidden rounded-[30px] border border-[color-mix(in_srgb,var(--accent)_20%,var(--line))] bg-[radial-gradient(circle_at_50%_50%,rgba(217,70,239,0.12),transparent_42%),color-mix(in_srgb,var(--accent-soft)_65%,var(--card-2))] p-7"
          delayMs={100}
        >
          <ConnectionDiagram />
        </FadeIn>
      </section>

      <section className="border-t section-divider py-14">
        <div className="grid gap-6">
          <FadeIn>
            <h2 className="text-[clamp(30px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.045em]">
              A generated wiki, not just raw search.
            </h2>
            <p className="mt-3.5 max-w-3xl text-base leading-7 text-muted-foreground">
              Context101 can synthesize the raw files in a brain into a readable
              wiki: topic pages, source citations, and architecture notes that
              agents can retrieve before falling back to raw docs. The goal is
              to give teammates a shared, reconciled view instead of a pile of
              disconnected chunks.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="surface-card p-5">
                <Sparkles aria-hidden size={22} />
                <h3 className="mt-4 text-lg font-semibold tracking-[-0.02em]">
                  Reconciled pages
                </h3>
                <p className="mt-2.5 text-sm leading-6 text-muted-foreground">
                  The wiki generator groups related files into human-readable
                  pages with citations back to the source material.
                </p>
              </div>
              <div className="surface-card p-5">
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
            <figure className="surface-card surface-card--wide overflow-hidden">
              <Image
                src="/wiki-preview.png"
                alt="Context101 generated wiki page showing synthesized prose, source citations, a Mermaid diagram, and code wiki navigation."
                width={3024}
                height={1720}
                className="h-auto w-full"
                sizes="(min-width: 1024px) 520px, 100vw"
              />
            </figure>
            <div className="mt-4 surface-callout p-5">
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

      <section className="border-t section-divider py-14">
        <FadeIn>
          <h2 className="text-[clamp(30px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.045em]">
            Your wiki, your model.
          </h2>
          <p className="mt-3.5 max-w-3xl text-base leading-7 text-muted-foreground">
            Wiki generation isn&apos;t locked to one provider. Pick Amazon
            Bedrock for a keyless, AWS-native setup, or bring your own API key
            for Anthropic, OpenAI, Google Gemini, or xAI Grok — configured per
            brain.
          </p>
        </FadeIn>
        <FadeIn
          className="mt-7 overflow-hidden surface-card surface-card--flat py-5"
          delayMs={60}
        >
          <ProviderMarquee />
        </FadeIn>
        <div className="mt-3.5 grid gap-3.5 md:grid-cols-3">
          <FadeIn className="surface-card p-5">
            <SlidersHorizontal aria-hidden size={22} />
            <h3 className="mt-4 text-lg font-semibold tracking-[-0.02em]">
              Per-brain model
            </h3>
            <p className="mt-2.5 text-sm leading-6 text-muted-foreground">
              Each brain chooses its own provider and model id, so a docs brain
              and a code brain can run on different models — searchable model
              lists are pulled live from each provider.
            </p>
          </FadeIn>
          <FadeIn
            className="surface-card p-5"
            delayMs={80}
          >
            <KeyRound aria-hidden size={22} />
            <h3 className="mt-4 text-lg font-semibold tracking-[-0.02em]">
              Bring your own key
            </h3>
            <p className="mt-2.5 text-sm leading-6 text-muted-foreground">
              Paste a provider key, validate it live, and pick from the models
              it unlocks. Prefer to stay fully on AWS? Bedrock needs no key at
              all.
            </p>
          </FadeIn>
          <FadeIn
            className="surface-card p-5"
            delayMs={160}
          >
            <LockKeyhole aria-hidden size={22} />
            <h3 className="mt-4 text-lg font-semibold tracking-[-0.02em]">
              Keys stay secret
            </h3>
            <p className="mt-2.5 text-sm leading-6 text-muted-foreground">
              API keys are written to AWS Secrets Manager — never stored in the
              database and never shown again after saving.
            </p>
          </FadeIn>
        </div>
      </section>

      <section className="border-t section-divider py-14">
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
          <figure className="surface-card surface-card--wide overflow-hidden">
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
          <FadeIn className="surface-card p-5">
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
            className="surface-card p-5"
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
            className="surface-card p-5"
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

        <FadeIn className="mt-7 surface-callout p-5">
          <strong>External-source caveat:</strong> if a suggestion improves
          content that originally came from Google Docs, Notion, GitHub, or
          another connector, Context101 does not push that fix back to the
          original source of truth yet. Today you either update the source
          manually or accept the suggestion into Context101&apos;s stored
          markdown. Source-level writeback is a follow-up.
        </FadeIn>
      </section>

      <section className="border-t section-divider py-14 text-center">
        <FadeIn>
          <h2 className="text-[clamp(30px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.045em]">
            Small enough to try, real enough to evolve.
          </h2>
        </FadeIn>
        <div className="mt-7 grid gap-3.5 md:grid-cols-3">
          <FadeIn className="surface-card surface-card--stat px-4 py-6">
            <strong className="block text-[clamp(38px,6vw,58px)] leading-[0.95] font-bold tracking-[-0.055em]">
              <Counter to={5} />+
            </strong>
            <span className="mt-3 block text-[13px] leading-5 text-muted-foreground">
              MCP clients
            </span>
          </FadeIn>
          <FadeIn
            className="surface-card surface-card--stat px-4 py-6"
            delayMs={80}
          >
            <strong className="block text-[clamp(38px,6vw,58px)] leading-[0.95] font-bold tracking-[-0.055em]">
              $<Counter to={5} />-<Counter to={15} />
            </strong>
            <span className="mt-3 block text-[13px] leading-5 text-muted-foreground">
              monthly AWS cost at PoC scale
            </span>
          </FadeIn>
          <FadeIn
            className="surface-card surface-card--stat px-4 py-6"
            delayMs={160}
          >
            <strong className="block text-[clamp(38px,6vw,58px)] leading-[0.95] font-bold tracking-[-0.055em]">
              <Counter to={1} />
            </strong>
            <span className="mt-3 block text-[13px] leading-5 text-muted-foreground">
              shared codebase for hosted and self-hosted
            </span>
          </FadeIn>
        </div>
      </section>

      <section id="caveats" className="border-t section-divider py-14">
        <FadeIn>
          <h2 className="text-[clamp(30px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.045em]">
            Useful now, honest about limits.
          </h2>
          <p className="mt-3.5 max-w-3xl text-base leading-7 text-muted-foreground">
            Context101 started as a PoC for an internal company problem. The
            goal of open sourcing it is to let other teams deploy and evolve it,
            while the hosted app matures behind invite-controlled access.
          </p>
        </FadeIn>
        <div className="mt-7 grid gap-3.5 md:grid-cols-3">
          {caveats.map((body, index) => (
            <FadeIn
              className="surface-card p-5"
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
        <FadeIn className="mt-7 surface-callout p-5">
          <strong>Hosted alpha:</strong> the hosted app is moving toward paid
          access, but billing gates are not live yet. Until then, access should
          stay invite/allowlist controlled, with comped orgs like Platea handled
          explicitly in the control plane.
        </FadeIn>
      </section>

      <section className="border-t section-divider py-14">
        <FadeIn>
          <h2 className="text-[clamp(30px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.045em]">
            Good to know.
          </h2>
          <p className="mt-3.5 max-w-3xl text-base leading-7 text-muted-foreground">
            A few choices are pragmatic rather than perfect. Context101 started
            as a PoC, so the first version optimized for easy AWS deployment.
            The current open-source SaaS path is moving auth and orgs to Better
            Auth + Postgres while keeping AWS for content and retrieval.
          </p>
        </FadeIn>

        <div className="mt-7 grid gap-3.5 md:grid-cols-2">
          {faqs.map((item, index) => (
            <FadeIn
              className="surface-card p-5"
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

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t section-divider py-6 text-[13px] text-muted-foreground">
        <span>Context101 alpha. Open-source first.</span>
        <span>
          Marketing site in <code>site/</code>; deployable app in{" "}
          <code>web/</code>.
        </span>
      </footer>
    </main>
  );
}
