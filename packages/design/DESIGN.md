---
name: Context101
description: An MCP knowledge-base platform — isolated "brains" served to AI clients, wired across a dark synaptic identity.
# Posture note: the brand site (site/) is canonically hex; the product app (web/) is
# canonically OKLCH (it has an OKLCH doctrine). Each token below stays in its own
# surface's canonical format on purpose — OKLCH values trip Stitch's hex-only linter
# warning by design, not by mistake.
colors:
  # Shared brand identity
  brain-magenta: "#b855c9"
  brain-violet: "#8b5cf6"
  # Brand surface (site/) — dark only
  site-ink-bg: "#060509"
  site-ink-bg-2: "#09060c"
  site-foreground: "#f2eef8"
  site-muted: "#a89eb4"
  site-card: "#120e18"
  site-line: "#3b2d48"
  site-accent-soft: "#140818"
  # Product surface (web/) — light default, .dark variant. Canonical OKLCH.
  app-background: "oklch(0.99 0.006 328)"
  app-foreground: "oklch(0.16 0.02 328)"
  app-card: "oklch(1 0.005 328)"
  app-primary: "oklch(0.48 0.14 320)"
  app-muted-foreground: "oklch(0.5 0.04 328)"
  app-border: "oklch(0.9 0.022 328)"
  app-destructive: "oklch(0.577 0.245 27.325)"
  app-bg-dark: "oklch(0.12 0.018 328)"
  app-fg-dark: "oklch(0.97 0.012 328)"
  app-primary-dark: "oklch(0.58 0.16 320)"
typography:
  display:
    fontFamily: "Space Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(52px, 13vw, 82px)"
    fontWeight: 700
    lineHeight: 0.95
    letterSpacing: "-0.055em"
  headline:
    fontFamily: "Space Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(38px, 6vw, 58px)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.045em"
  title:
    fontFamily: "Space Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(30px, 4vw, 48px)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  app-body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  app: "0.625rem"
  app-sm: "0.375rem"
  app-lg: "0.625rem"
  site-card: "22px"
  site-card-wide: "28px"
  pill: "9999px"
spacing:
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2.5rem"
components:
  button-primary:
    backgroundColor: "{colors.app-primary}"
    textColor: "#fafafa"
    rounded: "{rounded.app}"
    padding: "0 0.625rem"
    height: "2rem"
  site-button-primary:
    backgroundColor: "{colors.brain-magenta}"
    textColor: "#fafafa"
    rounded: "{rounded.pill}"
    padding: "0 1rem"
    height: "2.5rem"
  site-button-outline:
    textColor: "{colors.site-foreground}"
    rounded: "{rounded.pill}"
    padding: "0 1rem"
    height: "2.5rem"
  site-surface-card:
    backgroundColor: "{colors.site-card}"
    textColor: "{colors.site-foreground}"
    rounded: "{rounded.site-card}"
    padding: "1.5rem"
  app-surface:
    backgroundColor: "{colors.app-card}"
    textColor: "{colors.app-foreground}"
    rounded: "{rounded.app-lg}"
---

# Design System: Context101

## 1. Overview

**Creative North Star: "The Synaptic Dark"**

Context101 looks like a powered-on brain in a dark room. Near-black substrate, signal moving along faint magenta-violet traces, light pooling only where there's activity — beams flowing between nodes, a cursor blinking after a typed line, a card edge catching the accent. The identity is unapologetically dark and unapologetically purple: the `--brain` mark is the loudest thing on the page, and that's the point. This is infrastructure with a pulse, built for engineers who'd rather see the wiring than a stock photo of a handshake.

The system spans two surfaces that are recognizably the same product. The **brand site** (`site/`) is drenched dark — `#060509` ground, luminous Space Grotesk headlines, animated synaptic beams — built to make a technical evaluator feel the product's point of view in three seconds. The **product app** (`web/`) is quieter and more instrumented: a light-default, magenta-tinted OKLCH palette (with a full `.dark` mode) on Geist, tuned for dense admin work — creating brains, wiring connectors, reviewing suggestions — where legibility and honest state beat spectacle. Brand can shout; product keeps its voice down. The shared `--brain` purple is the thread between them.

What this system explicitly rejects: **corporate-cold** sterility (no navy-and-gray fintech polish, no stock photography, no soulless enterprise sheen) and **enterprise-heavy** clutter (no AWS-console density, no walls of gray tables dumped on the user). It also refuses the cross-register AI tells: gradient text, side-stripe borders, decorative glassmorphism, the hero-metric template, identical icon-card grids, and tracked-uppercase eyebrows on every section.

**Key Characteristics:**
- Dark, purple, and committed to it — the brand mark leads, it doesn't hide
- Two registers, one identity: drenched-dark brand site, quiet light-default product app, shared accent
- Confident & tactile components — surfaces that lift, buttons that press, motion that rewards
- Depth is hybrid: flat at rest, real shadow only on things that float
- Engineer-grade legibility over decoration; honest state over fake progress

## 2. Colors

A dark, magenta-violet palette: a near-black ground with a single saturated brand accent carrying the identity, plus a tightly hue-anchored neutral ramp (everything tinted toward hue ~320–328 so grays never read cold).

### Primary
- **Brain Magenta** (`#b855c9`): The signature mark. The loudest accent on the system — primary buttons, active nav, focus rings, link color, the glow under synaptic beams, the brand mark itself. On the product app its working form is the muted OKLCH `--primary` (`oklch(0.48 0.14 320)` light / `oklch(0.58 0.16 320)` dark) so it reads as a UI accent, not a billboard.
- **Brain Violet** (`#8b5cf6`): The blue-violet support to the magenta. Used as the second stop in beams, gradients, and the focus ring (`--ring` / `--accent-2`), giving the accent a two-tone shimmer rather than a flat fill.

### Neutral
- **Site Ink** (`#060509`, with `#09060c` as a second ground): The brand site's near-black canvas. Not pure black — a faint violet tint so the purple accent sits in family, not on top of a void.
- **Site Foreground** (`#f2eef8`): Off-white body and heading text on the brand site. Warm-violet white, never clinical `#fff`.
- **Site Muted** (`#a89eb4`): Secondary/supporting text on dark. Tinted toward the brand hue so it reads dusty-lilac, not gray.
- **Site Line / Card** (`#3b2d48` line, `#120e18` card): Dividers and raised surfaces, both lifted off the ground by a few points of lightness and tinted violet.
- **App Neutrals** (OKLCH, hue 328): The product app builds its full neutral ramp in OKLCH anchored on hue 328 — `--background` `oklch(0.99 0.006 328)` (light) down to `oklch(0.12 0.018 328)` (dark), with `--muted-foreground`, `--border`, and `--card` stepped from the same hue. The faint chroma is deliberate: app grays lean magenta so the whole product feels like the brand at low volume.

### Tertiary
- **Destructive** (`oklch(0.577 0.245 27.325)` light / `oklch(0.704 0.191 22.216)` dark): The only hue that breaks the magenta family — a red reserved strictly for destructive actions and error state. Its foreignness is the signal.

### Named Rules
**The One Accent Rule.** There is exactly one brand color: the brain purple. Magenta and violet are two stops of the same identity, not separate roles. Never introduce a second decorative accent hue — the only non-purple color permitted is destructive red, and only on destructive/error affordances.

**The Tinted-Gray Rule.** No gray is neutral. Every background, border, and muted text value carries chroma toward hue ~320–328. A truly desaturated gray (`#888`, `oklch(... 0 ...)`) is forbidden — it reads cold and breaks the family.

## 3. Typography

**Display Font:** Space Grotesk (with `ui-sans-serif, system-ui` fallback) — brand site headings
**Body Font:** Inter (brand site) / Geist (product app)
**Label/Mono Font:** JetBrains Mono (with `ui-monospace, SFMono-Regular, Menlo` fallback)

**Character:** Space Grotesk gives the brand site a sharp, slightly mechanical display voice — geometric with quirks, technical without being cold. It's paired against Inter on a true contrast axis (distinctive geometric display vs. neutral humanist body), never two lookalike sans. The product app drops display entirely and runs on Geist, a quieter, screen-optimized neutral sans that gets out of the way of dense admin work. JetBrains Mono carries anything that is literally code or a token (brain IDs, MCP endpoints, connector keys) — when something is machine-addressable, it looks machine-addressable.

### Hierarchy
- **Display** (Space Grotesk, 700, `clamp(52px, 13vw, 82px)`, line-height 0.95, tracking -0.055em): Brand-site hero only. Tight, luminous, one per page.
- **Headline** (Space Grotesk, 700, `clamp(38px, 6vw, 58px)`, line-height 1.05, tracking -0.045em): Brand-site section headings.
- **Title** (Space Grotesk, 600, `clamp(30px, 4vw, 48px)`, line-height 1.1, tracking -0.02em): Sub-section and feature headings.
- **Body** (Inter, 400, 1rem, line-height 1.6): Brand-site prose. Cap measure at 65–75ch.
- **App Body** (Geist, 400, 0.875rem, line-height 1.5): Product-app default text — denser, smaller, tuned for tables and forms.
- **Mono / Token** (JetBrains Mono, 500, 0.8125rem): IDs, endpoints, code, tokens.

### Named Rules
**The Display-Stays-Home Rule.** Space Grotesk display sizes live on the brand site. The product app does not use display type — admin screens earn hierarchy through weight, size, and spacing on Geist, not by importing the marketing voice.

**The Mono-Means-Machine Rule.** JetBrains Mono is reserved for things a machine reads or addresses: brain IDs, MCP URLs, bearer tokens, connector keys, code. Never use mono for decorative emphasis.

## 4. Elevation

Hybrid. Surfaces are flat at rest — depth comes from tonal layering (a card is a few points lighter than its ground and edged with an accent-tinted border), inset top highlights, and the brand's signature accent glow, not from drop shadows. Real `box-shadow` is reserved for things that genuinely float: dialogs, popovers, dropdowns, and the lift on hover for interactive surfaces. A flat card with a heavy ambient shadow is the 2014 tell; here, if it isn't floating, it isn't shadowed.

### Shadow Vocabulary
- **Inset highlight** (`box-shadow: inset 0 1px 0 color-mix(in oklch, var(--primary) 8%, transparent)`): The default "resting" treatment on `app-surface` and `surface-card` — a single bright top edge that reads as light catching a raised lip, not a drop shadow.
- **Accent ring** (`box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 3%, transparent)`): A barely-there accent-tinted outline that keeps surfaces in the purple family.
- **Float** (a real `0 N px` ambient shadow): Applied only to overlays (dialog, popover, dropdown, toast) and to interactive surfaces on `:hover`/`:active` lift.

### Named Rules
**The Flat-Until-It-Floats Rule.** Resting surfaces get tonal layering, an inset highlight, and an accent-tinted border — never an ambient drop shadow. Drop shadows appear only on elements that leave the plane: overlays, and the hover/active lift of tactile components.

## 5. Components

Components feel **confident & tactile**: they have weight and they respond. Surfaces lift on hover, buttons press down on active (`active:translate-y-px`), focus is a visible accent ring. Nothing is purely decorative; every state change is feedback.

### Buttons
- **Shape:** Product app — gently rounded rectangles, `0.625rem` radius (`rounded-lg`), compact `h-8` default. Brand site — full pills (`rounded-full`), taller `h-10` default.
- **Primary:** Filled with the brand accent (`--primary` in-app / `--brain` magenta on site), near-white text (`#fafafa`). Padding scales by surface: tight in-app (`px-2.5`), roomier on site (`px-4`).
- **Hover / Active:** Background lightens (`hover:bg-primary/90`); in-app the button presses down a pixel on active. Transitions are color/transform only — never layout.
- **Secondary / Outline / Ghost:** Outline uses an accent-tinted border over an accent-soft wash; ghost is transparent with a muted hover fill. Destructive is a red-tinted wash (`bg-destructive/10`), not a solid red fill — loud enough to warn, restrained enough not to dominate.
- **Focus:** Visible accent ring (`focus-visible:ring-3 ring-ring/50` in-app, `ring-2` on site). Never removed.

### Cards / Containers
- **Corner Style:** Brand site — `22px` (`surface-card`), `28px` for wide hero containers. Product app — `--radius-lg` (`0.625rem`) via `app-surface`.
- **Background:** A 165° gradient from an accent-soft tint into the base card color, so surfaces glow faintly toward the light source rather than sitting as flat fills.
- **Border:** A 1px accent-tinted line (`color-mix` of `--accent` into `--line`/`--border`). This is the primary depth cue — see Elevation.
- **Shadow Strategy:** Inset top highlight at rest; ambient shadow only on hover-lift. Per the Flat-Until-It-Floats Rule.
- **Internal Padding:** `1.5rem` default; wide containers scale up.
- **Nesting:** Never nest a card inside a card. Use tonal layering or a divider instead.

### Inputs / Fields
- **Style:** 1px border (`--input` / `--border`, accent-tinted), card background, app radius. Geist text in-app.
- **Focus:** Border shifts to the accent ring color plus a `ring-3` accent glow; no layout shift.
- **Error / Disabled:** Error borrows the destructive red on border + ring (`aria-invalid:border-destructive`); disabled drops to `opacity-50` with pointer events off.
- **Placeholder:** Must clear 4.5:1 against the field background — not the default muted gray. On dark fields this means a lifted lilac, not a dim charcoal.

### Navigation
- **Style:** Quiet by default — muted foreground, no background. Active item gets `app-nav-active`: an accent-tinted background wash, accent text and icon color, and an inset 1px accent ring. The active state is the only loud thing in the nav.
- **Mobile:** Collapses to a sheet/drawer; active treatment carries through unchanged.

### Signature: Synaptic Beams
The system's defining custom element. An SVG network of nodes connected by dashed links that flow (`brain-beam-flow`, dash-offset animation) with nodes that pulse (`brain-node-pulse`, opacity + scale). Rendered at low opacity (0.42 on site, up to 0.68 in app dark mode) as an ambient background layer — the visual literalization of "brains" and signal. Always decorative and `aria-hidden`; never gates content. Fully disabled under `prefers-reduced-motion`.

### Motion
- **Easing:** Exponential ease-out (`cubic-bezier(0.25, 1, 0.5, 1)`). No bounce, no elastic.
- **Vocabulary:** `fade-rise` (entrance: 12px up + fade, staggerable via `--delay`), `cursor-blink` (typed-line cursor), `marquee` (logo rows, pausable on hover), and the synaptic beam/pulse loops.
- **Reduced motion:** Every animation has a `prefers-reduced-motion: reduce` off-switch already wired in both stylesheets — beams freeze, marquee becomes a static scroll, fades resolve instantly. This is non-negotiable.

## 6. Do's and Don'ts

### Do:
- **Do** lead with the brain purple. It's the one accent — primary actions, active states, focus rings, the brand mark. Magenta (`#b855c9`) and violet (`#8b5cf6`) are two stops of the same identity.
- **Do** tint every neutral toward hue ~320–328. App grays lean magenta on purpose so the product reads as the brand at low volume.
- **Do** keep the brand site dark and drenched (`#060509` ground) and the product app quiet (light-default OKLCH, with `.dark`). Same identity, two volumes.
- **Do** convey resting depth with tonal layering, an inset highlight, and an accent-tinted border. Save real drop shadows for things that float (dialogs, popovers, hover-lift).
- **Do** make components tactile: hover lifts, active presses (`translate-y-px`), focus shows a visible accent ring.
- **Do** use JetBrains Mono for anything machine-addressable — brain IDs, MCP endpoints, tokens, code.
- **Do** keep `prefers-reduced-motion` alternatives on every animation, and keep the synaptic beams `aria-hidden` and non-blocking.
- **Do** show honest state. Pending / ingesting / ready / failed must each be visibly distinct — no silent failures, no fake progress.

### Don't:
- **Don't** go corporate-cold. No navy-and-gray fintech sterility, no stock photography, no soulless enterprise polish. The product has a point of view.
- **Don't** go enterprise-heavy. No AWS-console density, no walls of gray tables dumped on the user. Surface what matters; hide the machinery.
- **Don't** use a truly desaturated gray anywhere. It reads cold and breaks the purple family (The Tinted-Gray Rule).
- **Don't** introduce a second decorative accent hue. Destructive red is the only non-purple color, and only on destructive/error affordances (The One Accent Rule).
- **Don't** put Space Grotesk display type in the product app. Admin hierarchy comes from weight and spacing on Geist (The Display-Stays-Home Rule).
- **Don't** drop an ambient shadow on a resting surface — that's the 2014 tell (The Flat-Until-It-Floats Rule).
- **Don't** nest a card inside a card. Ever.
- **Don't** ship the cross-register AI tells: gradient text (`background-clip: text`), side-stripe borders (`border-left` > 1px as a colored accent), decorative glassmorphism, the hero-metric template, identical icon-card grids, or tracked-uppercase eyebrows above every section.
- **Don't** let muted or placeholder text fall below 4.5:1 against its background, especially the dusty-lilac muted on dark.
