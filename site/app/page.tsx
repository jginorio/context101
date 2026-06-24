import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Search,
} from "lucide-react";
import { BrainGlobe } from "@/components/brain-globe";
import { FadeIn } from "@context101/ui/fade-in";
import { IntegrationsBeam } from "@context101/ui/integrations-beam";
import { ProviderMarquee } from "@/components/provider-logos";
import { GithubLogo, SOURCES } from "@context101/ui/stack-logos";
import { Button } from "@/components/ui/button";
import { Marquee } from "@/components/ui/marquee";

const REPO_URL = "https://github.com/jginorio/context101";
const WAITLIST_URL = "https://tally.so/r/eqzrzO";

const limits = [
  "Generated wiki pages are useful at PoC scale. Large corpora still need better batching, caching, and source selection.",
  "Connectors sync into Context101 markdown today. Source-level writeback is still manual.",
  "Hosted access is invite-controlled while billing, SSO, and email verification mature.",
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
          <h1 className="text-[clamp(52px,13vw,82px)] leading-[0.95] font-bold tracking-[-0.06em]">
            One brain.
            <br />
            <span className="text-primary">Every AI tool.</span>
          </h1>

          <p className="mt-6 max-w-sm text-base leading-7 text-balance text-muted-foreground sm:max-w-xl sm:text-lg sm:leading-8">
            One approved knowledge base that feeds Cursor, Claude, Devin, and
            your own agents. Open source.
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

      <section className="border-t section-divider py-14 sv2">
        <FadeIn className="cr2">
          <h2 className="sv2-h">Connect your sources. Read from one place.</h2>
          <p className="sv2-p">
            Connect team docs once. Every AI tool reads the same source.
          </p>
          <div className="cr2-grid">
            <div className="cr2-beam">
              <IntegrationsBeam className="ib-v" />
            </div>
            <ol className="sv2-steps cr2-steps">
              <li className="sv2-step">
                <span className="sv2-num">01</span>
                <div>
                  <h3>Connect your sources</h3>
                  <p>
                    Bring your team&apos;s knowledge in from Google Docs, Notion,
                    GitHub, or markdown. Add a source once and Context101 keeps
                    it together in one brain.
                  </p>
                </div>
              </li>
              <li className="sv2-step">
                <span className="sv2-num">02</span>
                <div>
                  <h3>Read from one place</h3>
                  <p>
                    Cursor, Claude, Devin, or your own agents read from that
                    same brain through MCP. One source of truth, not scattered
                    docs.
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </FadeIn>
      </section>

      <section className="border-t section-divider py-14 sv2 tm">
        <FadeIn>
          <h2 className="sv2-h">Built for teams, with real access control.</h2>
          <p className="sv2-p">
            Organizations, roles, and isolated brains — on a self-hostable
            Better Auth + Postgres control plane.
          </p>
          <ol className="sv2-steps">
            <li className="sv2-step">
              <div>
                <h3>Invite &amp; onboard</h3>
                <p>Join from an email invite — no separate signup.</p>
              </div>
            </li>
            <li className="sv2-step">
              <div>
                <h3>Roles &amp; access</h3>
                <p>Owners set roles. Remove a member, sessions revoke instantly.</p>
              </div>
            </li>
            <li className="sv2-step">
              <div>
                <h3>Multiple workspaces</h3>
                <p>Switch orgs at sign-in, or spin up a new one anytime.</p>
              </div>
            </li>
          </ol>
        </FadeIn>
      </section>

      <section className="border-t section-divider py-14">
        <FadeIn>
          <h2 className="text-[clamp(30px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.045em] text-balance">
            Every source, reconciled into one corpus.
          </h2>
          <p className="mt-3.5 max-w-2xl text-base leading-7 text-muted-foreground text-pretty">
            Context101 reconciles your connected docs into a single brain — one
            place your tools read from, instead of scattered files.
          </p>
        </FadeIn>
        <FadeIn className="corpus-modes" delayMs={80}>
          <div className="corpus-mode">
            <div className="corpus-mode-head">
              <BookOpen aria-hidden size={20} />
              <h3>Read it</h3>
            </div>
            <p>
              Readable wiki pages — topic pages, citations, and architecture
              notes, generated from the raw docs.
            </p>
          </div>
          <div className="corpus-mode">
            <div className="corpus-mode-head">
              <Search aria-hidden size={20} />
              <h3>Search it</h3>
            </div>
            <p>
              Always-on retrieval over the source material, served to any AI
              tool through MCP.
            </p>
          </div>
        </FadeIn>
      </section>

      <section className="border-t section-divider py-14">
        <FadeIn>
          <h2 className="text-[clamp(30px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.045em] text-balance">
            Bring the model you trust.
          </h2>
          <p className="mt-3.5 max-w-2xl text-base leading-7 text-muted-foreground text-pretty">
            Bedrock works out of the box. Anthropic, OpenAI, Gemini, and Grok
            keys can be configured per brain and stored in AWS Secrets Manager.
          </p>
        </FadeIn>
        <FadeIn
          className="mt-7 overflow-hidden surface-card surface-card--flat py-5"
          delayMs={60}
        >
          <ProviderMarquee />
        </FadeIn>
      </section>

      <section id="caveats" className="border-t section-divider py-14">
        <FadeIn>
          <h2 className="text-[clamp(30px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.045em] text-balance">
            Alpha, stated plainly.
          </h2>
          <p className="mt-3.5 max-w-2xl text-base leading-7 text-muted-foreground text-pretty">
            Useful for trusted teams now. Still honest about the rough edges.
          </p>
        </FadeIn>

        <FadeIn className="mt-7 surface-callout p-5">
          <ul className="grid gap-3 text-sm leading-6 text-muted-foreground md:grid-cols-3">
            {limits.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        </FadeIn>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t section-divider py-6 text-[13px] text-muted-foreground">
        <span>Context101 alpha. Open-source first.</span>
        <div className="flex items-center gap-3">
          <Link
            href="/terms-of-use"
            className="transition-colors hover:text-foreground"
          >
            Terms of Use
          </Link>
          <Link
            href="/privacy-policy"
            className="transition-colors hover:text-foreground"
          >
            Privacy Policy
          </Link>
        </div>
      </footer>
    </main>
  );
}
