# Product

## Register

product

> This repo ships two design surfaces. The default register above is **product** (the `web/` admin). **cli** is `packages/cli` (bin `context101`) — operate-in-a-terminal; louder than `web/`, still an instrument. Brand/marketing is not in this repo.

## Users

Engineers and ops on trusted teams. Two hands-on surfaces: `web/` admin (brains, connectors, suggestions, MCP tokens) and `context101-cli` (the only front door for AWS: init, deploy, list, destroy, config, help).

## Product Purpose

Context101 is a thin self-hostable wrapper around Amazon Bedrock Knowledge Bases — S3 + S3 Vectors, FastMCP per-brain, Better Auth + Postgres control plane. Self-host now; paid hosting later (not there yet — alpha / trusted-team only). Do not invent hosted billing, public multi-tenant SaaS, or per-brain RBAC.

Not a wiki app. Wiki generation is parked (not on admin chrome). Conflicts detection is parked (no Opus on query/ingest). Product focus is sources + retrieve. Retrieval is raw-first. Do not pitch Bedrock retrieve as a product feature they offer; do not pitch model access or BYO-LLM.

Each "brain" is a sealed knowledge base — its own S3 bucket, Bedrock KB, vector index, suggestions queue, and MCP token — created from the admin UI and served to AI clients via `/brain/<id>/mcp`. Success: a trusted team can stand up, populate, and serve isolated brains with honest state.

The CLI is how people stand up and operate the stack on their AWS. `npx context101-cli` or a global `context101`. Package name is context101-cli (bin `context101`); unscoped `npx context101` is Context7's MCP — unrelated.

## Brand Personality

Bold and distinctive. Opinionated infrastructure with a memorable identity — the purple "brain" mark (`#b855c9` / `#8b5cf6`) is pushed forward, not buried. Voice is technically fluent and direct: it talks to engineers as peers, never markets at them. Confident without being loud for its own sake. Honest about its alpha status. Hero line for brand and CLI: `your context. every agent.`

## Anti-references

- **Corporate-cold.** No navy-and-gray fintech sterility, no stock photography, no soulless enterprise polish. The product has a point of view.
- **Enterprise/heavy.** No cluttered admin consoles, no dense walls of gray tables, no AWS-console-style complexity dumped on the user. Surface what matters; hide the machinery.
- **No figlet CLI.** No ASCII box-drawing frames, no AWS-console column dump in the terminal, no marketing essay under the banner.
- Plus the cross-register absolute bans: gradient text, side-stripe borders, glassmorphism-by-default, the hero-metric template, identical card grids, tracked-uppercase eyebrows on every section.

## Design Principles

1. **Isolation made legible.** Each brain is a sealed unit; the UI should make that boundary obvious and reassuring, never blur brains together.
2. **Control without clutter.** Admins want levers, not a maze. Expose configuration progressively; default to the calm state and reveal depth on demand.
3. **Trustworthy feedback.** This tool provisions real cloud infrastructure and ingests real data. Every action's state — pending, ingesting, ready, failed — must be honest and visible. No silent failures, no fake progress.
4. **One identity, two registers here.** `web/` is quiet admin (product, light-default). CLI is louder than web — the mark and accent lead — but still an instrument, not a landing page. Shared accent: `#b855c9` / `#8b5cf6`. Hero line for CLI: `your context. every agent.`
5. **Talk to engineers as peers.** Precise, direct copy. Name things what they are (brain, connector, MCP token). No marketing fluff, no dumbing down.

## Accessibility & Inclusion

Light-touch for the alpha. No formal WCAG target, but hold the non-negotiables: body text stays legible, interactive elements are keyboard-reachable, and motion respects `prefers-reduced-motion`. CLI color is TTY-only and respects `NO_COLOR`. Revisit a formal AA pass before any external/multi-tenant launch.
