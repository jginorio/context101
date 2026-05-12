# Product

## Register

brand

## Users

The primary reader is a staff or senior engineer (or a tech-leaning engineering manager) at a small-to-mid team who:

- Already uses Claude Desktop, Cursor, Claude Code, or Devin daily, and feels the "each teammate's AI only knows what that person told it" failure mode.
- Is comfortable with AWS, CDK, Docker, and running infrastructure in their own account.
- Evaluates and decides on AI/dev-tooling for their team. Adoption flows through them.
- Is allergic to marketing fluff. Trusts architecture diagrams, honest scope, and code on the page; distrusts demo gates, "future of work" headlines, and vanity metrics.

When they land on the page, they are scanning to answer one question: *is this real, is the architecture sane, can I be running it in an afternoon.* Wider personas (PMs, analysts, marketers) are downstream consumers of the brain once it exists; they do not decide adoption and are not the marketing surface's primary audience.

## Product Purpose

Context101 is a self-hosted, MCP-native shared knowledge base for teams. Teammates write knowledge once; any MCP-compatible AI client (Cursor, Claude Code, Claude Desktop, Devin, custom agents) retrieves it via semantic search.

It exists to stop the failure mode where every person's AI is locked to their own chat history, and decisions get made on fragmented memory. It runs entirely in the user's AWS account on managed primitives (Bedrock Knowledge Bases, S3 Vectors, Titan embed v2, App Runner, Amplify) at PoC-scale costs (~$5-15/mo). Data never leaves the user's perimeter; there is no SaaS layer, no per-seat pricing, no vendor lock-in.

Success for the landing page: a qualified engineer reads it, believes the architecture is real and the scope is honest, and clones the repo.

## Brand Personality

Three words: **honest, technical, dry.**

The voice sits closer to Anthropic docs, Linear changelogs, Cursor marketing, and the Vercel/Next docs than to b2b-SaaS marketing. It writes engineer-to-engineer. It calls limitations out by name on the same page that sells the product. It shows code, architecture, and concrete cost numbers above the fold instead of behind a "request demo" CTA. It doesn't hide the seams.

Wit is allowed; performative enthusiasm is not. Emoji are not part of the voice. Em dashes are not part of the voice (use commas, colons, semicolons, periods, parentheses). Headlines are short and declarative; body copy is specific.

## Anti-references

The page should never read like, and should never visually resemble:

- **SaaS-cream landing pages**: pastel hero, three-card "Why us" grid with icons, gradient blob, faux customer logo wall, "Trusted by teams at" social proof.
- **B2B-purple "future of work" pages**: vague headlines about "transforming how teams collaborate", purple gradients, stock illustrations of abstract people.
- **AI-startup template**: "Agentic [thing] platform", gradient text headline, neon-on-near-black, vague "agents do the work" copy, no actual technical detail.
- **Fintech-navy/teal corporate**: deep navy + gold or teal accents, serif headline trying to look "trusted", security/compliance theatre above utility.
- **Glassmorphism dashboards**: blurred glass cards, floating UI screenshots tilted at 15deg, decorative depth without function.
- **Enterprise opacity**: pricing hidden, scope hidden, "contact sales" as a primary CTA, limitations not mentioned until the docs.

It should also not look generically *shadcn* — the default starter aesthetic with no point of view.

## Design Principles

1. **Show, don't tell.** Architecture, code, and cost numbers belong on the marketing surface, not behind a CTA. The reader should believe the system is real before they finish the first fold.
2. **Honest about scope.** Limitations are named on the page that sells the product. "Not enterprise yet, PoC not 1.0" is a feature: it filters in the right audience and earns trust with everyone else.
3. **Engineer-to-engineer.** Every word and pixel passes the "would a skeptical staff engineer roll their eyes" test. No marketing adjectives without a concrete claim attached.
4. **Restraint, then a point of view.** Monochrome neutrals, deliberate typography, and rhythm do the work. No gradient text, no glassmorphism, no hero-metric template. But also no generic shadcn-starter neutrality — the page should be recognizably *this* product, not any product.
5. **One promise, reinforced.** Write knowledge once, retrieve from every MCP-compatible agent. Every section should either restate that promise more concretely or earn it.

## Accessibility & Inclusion

- WCAG AA contrast on all text and meaningful UI.
- Visible focus indicators on every interactive element; never remove without replacement.
- Full keyboard navigation; tab order matches visual order.
- Respect `prefers-reduced-motion`: animations either pause or collapse to instant transitions.
- Color is never the sole signal for state (status, validity, emphasis). Pair with icon, weight, or text.
- Touch targets meet 44x44 on coarse pointers.
- Code blocks and diagrams have readable text alternatives or stay readable when zoomed.
