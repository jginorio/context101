import Link from "next/link";
import {
  ArrowRight,
  ListChecks,
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
  "Self-host in your AWS account. Hosted is waitlist-only — not public, no billing.",
  "Connectors sync into markdown today. Source-level writeback is still manual.",
  "Better Auth signs people in. Every org member is an admin. No per-brain RBAC yet.",
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
            Waitlist
          </a>
        </Button>
      </nav>

      <section className="relative overflow-x-clip py-16 text-center sm:py-24">
        <BrainGlobe className="pointer-events-none absolute left-1/2 top-[54%] -z-10 h-[min(135vw,860px)] w-[min(135vw,860px)] -translate-x-1/2 -translate-y-1/2 opacity-70 mask-[radial-gradient(circle_at_center,#000_34%,transparent_70%)]" />

        <FadeIn className="mx-auto flex max-w-3xl flex-col items-center">
          <h1 className="text-[clamp(52px,13vw,82px)] leading-[0.95] font-bold tracking-[-0.06em]">
            Your AWS.
            <br />
            <span className="text-primary">Every agent.</span>
          </h1>

          <p className="mt-6 max-w-sm text-base leading-7 text-balance text-muted-foreground sm:max-w-xl sm:text-lg sm:leading-8">
            A thin wrapper around Amazon Bedrock Knowledge Bases. Self-host it
            in your account. Hosted later — not yet.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <a href={REPO_URL}>
                <GithubLogo className="size-4" />
                Self-host it
              </a>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href={WAITLIST_URL} target="_blank" rel="noreferrer">
                Join the waitlist
                <ArrowRight className="size-4" />
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
          <h2 className="sv2-h">Sources in. Agents retrieve.</h2>
          <p className="sv2-p">
            Docs land in a Bedrock Knowledge Base. Every agent reads the same
            raw source.
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
                    Bring docs in from Google Docs, Notion, GitHub, or markdown.
                    They live in a brain — S3 plus a Bedrock KB.
                  </p>
                </div>
              </li>
              <li className="sv2-step">
                <span className="sv2-num">02</span>
                <div>
                  <h3>Retrieve through MCP</h3>
                  <p>
                    Cursor, Claude, Devin, or your own agents hit per-brain MCP.
                    Same KB. Raw retrieve.
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </FadeIn>
      </section>

      <section className="border-t section-divider py-14 sv2 tm">
        <FadeIn>
          <h2 className="sv2-h">Isolated brains on your AWS.</h2>
          <p className="sv2-p">
            Each brain is its own bucket, Bedrock KB, vector index, and MCP
            token. The admin UI manages brains, sources, and the review queue.
            Better Auth exists; per-brain roles do not.
          </p>
          <ol className="sv2-steps">
            <li className="sv2-step">
              <div>
                <h3>Isolated brains</h3>
                <p>
                  Own S3 bucket, own Bedrock KB, own vector index, own MCP
                  bearer token.
                </p>
              </div>
            </li>
            <li className="sv2-step">
              <div>
                <h3>Admin UI</h3>
                <p>
                  Create brains, connect sources, review suggestions. That&apos;s
                  the app.
                </p>
              </div>
            </li>
            <li className="sv2-step">
              <div>
                <h3>Auth, stated plainly</h3>
                <p>
                  Better Auth + Postgres. Signed-in teammates are admins.
                  Per-brain RBAC is not shipped.
                </p>
              </div>
            </li>
          </ol>
        </FadeIn>
      </section>

      <section className="border-t section-divider py-14">
        <FadeIn>
          <h2 className="text-[clamp(30px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.045em] text-balance">
            Raw retrieve. Human review.
          </h2>
          <p className="mt-3.5 max-w-2xl text-base leading-7 text-muted-foreground text-pretty">
            Agents search the source docs through Bedrock. Suggestions wait for
            a person.
          </p>
        </FadeIn>
        <FadeIn className="corpus-modes" delayMs={80}>
          <div className="corpus-mode">
            <div className="corpus-mode-head">
              <Search aria-hidden size={20} />
              <h3>Search it</h3>
            </div>
            <p>
              Bedrock retrieve over the raw docs. MCP serves those chunks to any
              agent.
            </p>
          </div>
          <div className="corpus-mode">
            <div className="corpus-mode-head">
              <ListChecks aria-hidden size={20} />
              <h3>Review it</h3>
            </div>
            <p>
              Agents can suggest a change. A human approves it in the queue
              before it lands in the KB.
            </p>
          </div>
        </FadeIn>
      </section>

      <section className="border-t section-divider py-14">
        <FadeIn>
          <h2 className="text-[clamp(30px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.045em] text-balance">
            Retrieve runs on Bedrock.
          </h2>
          <p className="mt-3.5 max-w-2xl text-base leading-7 text-muted-foreground text-pretty">
            Amazon Bedrock Knowledge Bases, S3, and S3 Vectors. You need Bedrock
            model access in the account you deploy to.
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
            Useful for trusted teams who can run AWS. Not a hosted SaaS.
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
        <span>Context101 alpha. Self-host first.</span>
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
