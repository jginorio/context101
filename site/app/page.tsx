import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  Brain,
  Building2,
  CheckCircle2,
  Cloud,
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
} from "lucide-react";
import { BrainGlobe } from "@/components/brain-globe";
import { ConnectionDiagram } from "@/components/connection-diagram";
import { Counter } from "@/components/counter";
import { FadeIn } from "@/components/fade-in";
import { ProviderMarquee } from "@/components/provider-logos";
import { GithubLogo, SOURCES } from "@/components/stack-logos";
import { Button } from "@/components/ui/button";
import { Marquee } from "@/components/ui/marquee";

const REPO_URL = "https://github.com/jginorio/context101";
const WAITLIST_URL = "https://tally.so/r/eqzrzO";

const features = [
  {
    title: "Connect your sources",
    body: "Bring your team's knowledge in from the tools you already use — Google Docs, Notion, GitHub, or plain markdown. Add a source once and Context101 keeps it all together in one brain.",
    Icon: Plug,
  },
  {
    title: "Read from one place",
    body: "Every AI tool — Cursor, Claude, Devin, or your own agents — reads from that same brain through MCP. One source of truth, instead of scattered docs and copy-pasted context.",
    Icon: Brain,
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
          <span className="truncate">Context101</span>
        </Link>
        <Button asChild size="sm">
          <a href={WAITLIST_URL} target="_blank" rel="noreferrer">
            Get started
          </a>
        </Button>
      </nav>

      <section className="relative overflow-x-clip py-16 text-center sm:py-24">
        <BrainGlobe className="pointer-events-none absolute left-1/2 top-[54%] -z-10 h-[min(135vw,860px)] w-[min(135vw,860px)] -translate-x-1/2 -translate-y-1/2 opacity-70 mask-[radial-gradient(circle_at_center,#000_34%,transparent_70%)]" />

        <FadeIn className="mx-auto flex max-w-3xl flex-col items-center">
          <h1 className="text-[clamp(44px,8vw,82px)] leading-[0.95] font-bold tracking-[-0.06em]">
            One brain.
            <br />
            <span className="text-primary">Every AI tool.</span>
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-8 text-balance text-muted-foreground">
            The hosted knowledge base that feeds Cursor, Claude, Devin, and your
            own agents the same approved context. Want to run it yourself? It&apos;s
            open source.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <a href={WAITLIST_URL} target="_blank" rel="noreferrer">
                Join the waitlist
                <ArrowRight className="size-4" />
              </a>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href={REPO_URL}>
                <GithubLogo className="size-4" />
                View source
              </a>
            </Button>
          </div>
        </FadeIn>

        <FadeIn
          className="mt-14 flex flex-col items-center gap-5"
          delayMs={140}
        >
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
            Connects the tools your team already uses
          </span>
          <Marquee className="w-full max-w-2xl py-1 [--duration:28s] [--gap:3rem]">
            {SOURCES.map(({ name, Logo }) => (
              <div
                key={name}
                className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
                title={name}
              >
                <Logo className="h-4 w-4 shrink-0" />
                <span className="whitespace-nowrap text-sm font-medium tracking-[-0.01em]">
                  {name}
                </span>
              </div>
            ))}
          </Marquee>
        </FadeIn>
      </section>

      <section className="border-t section-divider py-14">
        <FadeIn>
          <h2 className="text-[clamp(30px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.045em]">
            Connect your sources. Read from one place.
          </h2>
          <p className="mt-3.5 max-w-3xl text-base leading-7 text-muted-foreground">
            Plug in the tools your team already uses, and every AI tool reads
            from one shared source — no more scattered docs or copy-pasting
            context into each tool.
          </p>
        </FadeIn>
        <div className="mt-7 grid gap-3.5 md:grid-cols-2">
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
          className="mt-7 overflow-x-auto overflow-y-hidden rounded-[30px] border border-[color-mix(in_srgb,var(--accent)_14%,var(--line))] bg-[radial-gradient(circle_at_50%_50%,rgba(184,85,201,0.06),transparent_42%),color-mix(in_srgb,var(--accent-soft)_52%,var(--card-2))] p-7"
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
      </footer>
    </main>
  );
}
