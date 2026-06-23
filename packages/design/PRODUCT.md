# Product

## Register

product

> This repo has two design surfaces and the work splits evenly between them. The default register above is **product** (the `web/` admin app). The marketing surface is **brand** (the `site/` landing) — when working on `site/` or any landing/campaign/long-form page, treat the task as `brand` and read `reference/brand.md` instead of `reference/product.md`.

## Users

Engineers and technical operators on trusted internal teams who self-host Context101. In the **product** surface (`web/`) they are admins: creating and managing isolated "brains" (knowledge bases), wiring up connectors (Google Docs/Sheets/Slides, Notion, GitHub), reviewing ingestion suggestions, and minting per-brain MCP bearer tokens. Their context is hands-on configuration work — they value control, clarity, and trustworthy feedback over hand-holding. In the **brand** surface (`site/`) the audience is a developer or technical lead evaluating whether to adopt Context101 for their team.

## Product Purpose

Context101 is an open-source (alpha) MCP knowledge-base platform. Each "brain" is a fully isolated knowledge base — its own S3 bucket, Bedrock KB, vector index, suggestions queue, and MCP token — created on demand from the admin UI and served to AI clients (Claude, Cursor, Claude Code) via `/brain/<id>/mcp`. The control plane runs on Better Auth + Postgres; AWS owns content storage, retrieval, and background ingestion. Success: a trusted team can stand up, populate, and serve multiple knowledge brains to their AI tools with minimal friction and clear visibility into what's happening.

## Brand Personality

Bold and distinctive. Opinionated infrastructure with a memorable identity — the purple "brain" mark (`#b855c9` / `#8b5cf6`) is pushed forward, not buried. Voice is technically fluent and direct: it talks to engineers as peers, never markets at them. Confident without being loud for its own sake; the boldness comes from a committed dark palette and a strong accent, not from noise. Honest about its alpha status.

## Anti-references

- **Corporate-cold.** No navy-and-gray fintech sterility, no stock photography, no soulless enterprise polish. The product has a point of view.
- **Enterprise/heavy.** No cluttered admin consoles, no dense walls of gray tables, no AWS-console-style complexity dumped on the user. Surface what matters; hide the machinery.
- Plus the cross-register absolute bans: gradient text, side-stripe borders, glassmorphism-by-default, the hero-metric template, identical card grids, tracked-uppercase eyebrows on every section.

## Design Principles

1. **Isolation made legible.** Each brain is a sealed unit; the UI should make that boundary obvious and reassuring, never blur brains together.
2. **Control without clutter.** Admins want levers, not a maze. Expose configuration progressively; default to the calm state and reveal depth on demand.
3. **Trustworthy feedback.** This tool provisions real cloud infrastructure and ingests real data. Every action's state — pending, ingesting, ready, failed — must be honest and visible. No silent failures, no fake progress.
4. **One identity, two registers.** The purple "brain" accent and dark foundation carry across the marketing site and the app. Brand can be louder; product is quieter — but they're recognizably the same product.
5. **Talk to engineers as peers.** Precise, direct copy. Name things what they are (brain, connector, MCP token). No marketing fluff, no dumbing down.

## Accessibility & Inclusion

Light-touch for the alpha. No formal WCAG target, but hold the non-negotiables: body text stays legible against the dark background (don't let muted purples drop below readable contrast), interactive elements are keyboard-reachable, and motion respects `prefers-reduced-motion` (already wired in `site/globals.css`). Revisit a formal AA pass before any external/multi-tenant launch.
