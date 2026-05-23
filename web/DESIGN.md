---
name: Context101
description: One brain, every AI tool. A schematic-flat, monochrome MCP-native knowledge base.
colors:
  drafting-paper: "oklch(1 0 0)"
  carbon: "oklch(0.145 0 0)"
  graphite: "oklch(0.205 0 0)"
  paper-tint: "oklch(0.97 0 0)"
  specification-gray: "oklch(0.556 0 0)"
  pencil-line: "oklch(0.922 0 0)"
  focus-ring: "oklch(0.708 0 0)"
  drafting-paper-on-dark: "oklch(0.985 0 0)"
  carbon-card: "oklch(0.205 0 0)"
  carbon-mute: "oklch(0.269 0 0)"
  dark-pencil-line: "oklch(1 0 0 / 0.10)"
  alert-vermilion: "oklch(0.577 0.245 27.325)"
  alert-vermilion-soft: "oklch(0.704 0.191 22.216)"
  schematic-indigo: "oklch(0.488 0.243 264.376)"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 6vw, 3.75rem)"
    fontWeight: 600
    lineHeight: "1.05"
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.875rem, 4vw, 2.25rem)"
    fontWeight: 600
    lineHeight: "1.15"
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 500
    lineHeight: "1.35"
    letterSpacing: "normal"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.65"
    letterSpacing: "normal"
  label:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "1.4"
    letterSpacing: "0.01em"
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
  xl: "0.875rem"
  "2xl": "1.125rem"
spacing:
  hairline: "1px"
  xs: "0.25rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
  section: "5rem"
  section-lg: "7rem"
components:
  button-primary:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.drafting-paper-on-dark}"
    rounded: "{rounded.lg}"
    padding: "0.375rem 0.875rem"
    height: "2rem"
  button-primary-hover:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.drafting-paper-on-dark}"
  button-primary-active:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.drafting-paper-on-dark}"
  button-outline:
    backgroundColor: "{colors.drafting-paper}"
    textColor: "{colors.carbon}"
    rounded: "{rounded.lg}"
    padding: "0.375rem 0.875rem"
    height: "2rem"
  button-outline-hover:
    backgroundColor: "{colors.paper-tint}"
    textColor: "{colors.carbon}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.carbon}"
    rounded: "{rounded.lg}"
    padding: "0.375rem 0.875rem"
    height: "2rem"
  button-ghost-hover:
    backgroundColor: "{colors.paper-tint}"
    textColor: "{colors.carbon}"
  card:
    backgroundColor: "{colors.drafting-paper}"
    textColor: "{colors.carbon}"
    rounded: "{rounded.xl}"
    padding: "1rem"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.carbon}"
    rounded: "{rounded.lg}"
    padding: "0.25rem 0.625rem"
    height: "2rem"
  input-focus:
    backgroundColor: "transparent"
    textColor: "{colors.carbon}"
  badge-status:
    backgroundColor: "transparent"
    textColor: "{colors.specification-gray}"
    rounded: "{rounded.2xl}"
    padding: "0.25rem 0.75rem"
  stack-pill:
    backgroundColor: "{colors.drafting-paper}"
    textColor: "{colors.specification-gray}"
    rounded: "{rounded.md}"
    padding: "0.25rem 0.5rem"
---

# Design System: Context101

## 1. Overview

**Creative North Star: "The Engineer's Whiteboard"**

Context101 reads like a clean technical whiteboard, drawn deliberately. Surfaces are flat. Lines are honest 1-pixel borders, not decorative shadows. Connections are schematic diagrams. Type does the heavy lifting, because the audience is a skeptical staff engineer who trusts type and lines over gradients and glow. The page persuades by being legible, not by being loud.

Every chromatic decision is rationed. The palette is almost entirely achromatic neutrals so the rare non-neutral (an alert vermilion, a single dark-mode indigo) actually means something when it appears. Body copy stays in the 65 to 75 character range. Sections breathe at the page level: generous vertical rhythm at the seams, tighter rhythm inside cards. The animation budget is tiny and pointed: a typing rotate in the hero, a beam-flow along the MCP diagram, an active press on buttons. Nothing decorative ever moves.

This system rejects: SaaS-cream landing pages with three-card "Why us" grids and faux logo walls. B2B-purple "future of work" pages with abstract people illustrations. AI-startup template aesthetics with gradient-text headlines and neon-on-black. Fintech-navy or teal corporate trust theatre. Glassmorphism dashboards with tilted UI screenshots. Generic enterprise opacity that hides scope behind a "contact sales" CTA. It also rejects the default shadcn-starter look: monochrome alone is not a point of view.

**Key Characteristics:**
- Monochrome neutrals, OKLCH-canonical, with one rationed accent per surface.
- Flat-by-default: 1px rings carry separation; shadows are rare and earn their place.
- Schematic diagrams over decorative imagery; hand-drawn-feel beams on actual SVG paths.
- Type-first hierarchy: a sans display family does most of the work; mono punctuates labels and code.
- Honesty as ornament: code blocks, cost numbers, and limitations appear above the fold.

## 2. Colors

The palette is an OKLCH monochrome scale tinted toward zero chroma, with one rationed accent for state. Carbon is the strongest mark you can make; everything between Carbon and Drafting Paper is a graphite stop. Color is reserved for meaning.

### Primary
- **Carbon** (`oklch(0.145 0 0)`): Body text on light surfaces, the deepest mark in the system. In dark mode this becomes the page background. Used wherever maximum contrast or maximum quiet is needed.
- **Graphite** (`oklch(0.205 0 0)`): Primary surfaces on light backgrounds: the default button, the final-CTA section, the dark-mode card. Slightly softer than Carbon so it reads as "solid" rather than "stamped".

### Secondary
- **Schematic Indigo** (`oklch(0.488 0.243 264.376)`): Dark-mode-only sidebar accent in the admin app. Never used on the marketing surface. The single chromatic note inside the product register, treated as a tiny voice not a brand color.

### Tertiary
- **Alert Vermilion** (`oklch(0.577 0.245 27.325)` light, `oklch(0.704 0.191 22.216)` dark): Destructive actions and invalid form state only. Never decorative. The lighter tone in dark mode preserves contrast without screaming.

### Neutral
- **Drafting Paper** (`oklch(1 0 0)`): The default light surface. Pure-light by intent; in dark mode this becomes the text color.
- **Paper Tint** (`oklch(0.97 0 0)`): Hover background on outline and ghost buttons, secondary surface tint, very subtle muted band between sections.
- **Specification Gray** (`oklch(0.556 0 0)`): Body copy on muted bands, captions, labels, pill text. The voice of supporting prose.
- **Pencil Line** (`oklch(0.922 0 0)` light, `oklch(1 0 0 / 0.10)` dark): All separators, card rings, input borders. Always 1px, always full-side, never a colored stripe.
- **Focus Ring** (`oklch(0.708 0 0)`): The base color for focus rings; rendered with `ring-3` and 50 percent alpha so it sits visible but quiet.

### Named Rules

**The Ration Rule.** Chromatic color is reserved for state, not identity. Vermilion only marks destructive intent or error. The dark-mode Schematic Indigo is only ever the sidebar accent inside the product register. Anything else uses Carbon, Graphite, or a graphite step. If a section starts to feel "branded", remove the color, not the contrast.

**The 1px Border Rule.** Every separation is a 1-pixel ring around the full element or a 1-pixel horizontal divider. No 2px sides, no colored stripes, no `border-left: 4px` accents. Card edges and section seams both speak in the same line weight; that consistency is the brand.

## 3. Typography

**Display Font:** Geist (with `ui-sans-serif, system-ui, sans-serif` fallback)
**Body Font:** Geist (same family, weight does the work)
**Label/Mono Font:** Geist Mono (with `ui-monospace, SFMono-Regular, monospace` fallback)

**Character:** A single sans family carries the entire system, with mono reserved for labels, code, and small status badges. The pairing is technical without being terminal-cosplay: Geist's near-neutral grotesque hides until you read it, then disappears again. Tracking is tight on display sizes (-0.02em) so headlines feel set, not arranged.

### Hierarchy
- **Display** (600, `clamp(2.25rem, 6vw, 3.75rem)`, `1.05`): Reserved for large product moments. The public marketing homepage now lives in `../site`; admin pages should usually start at Headline.
- **Headline** (600, `clamp(1.875rem, 4vw, 2.25rem)`, `1.15`): Section headers. `text-balance` is mandatory so the last line never widows. Tracking `-0.015em`.
- **Title** (500, `1.125rem`, `1.35`): Card titles, list-item titles, small section heads. Sentence case, never uppercase.
- **Body** (400, `1rem`, `1.65`): Default paragraph. Line length capped at 65-75ch via `max-w-3xl` for prose sections. `leading-relaxed` (`1.625`) for marketing copy; `leading-normal` for dense UI.
- **Label** (400 mono, `0.75rem`, `1.4`): Pill text, status badges, hero supporting strap. Slight letter-spacing (`0.01em`) keeps mono readable at small sizes.

### Named Rules

**The Two-Weight Rule.** The system uses exactly two weights of Geist on the page: 400 for body, 500 for titles, 600 for headlines. Italics are permitted; semi-condensed, expanded, or weights between are not. Hierarchy comes from size and weight contrast, never from font swaps.

**The Mono Restraint Rule.** Geist Mono is for labels, code, and status pills. It is not a brand voice. Headlines are never set in mono. Body copy is never set in mono. If the impulse is to "make it feel technical", reach for tighter tracking and better content first.

## 4. Elevation

The system is flat by default. Depth is communicated through 1-pixel rings, background tonality (Drafting Paper vs Paper Tint vs Carbon Card), and the order of stacking, not through shadow. Surfaces rest on the page; they do not float over it.

Shadows exist, but they are rare and earn their place. Toasts (Sonner), dialogs, and dropdown menus inherit shadcn's `shadow-md` because they genuinely detach from the page; outside those, shadow is forbidden.

### Shadow Vocabulary
- **Overlay** (`box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)`): Toasts, dropdowns, popovers. Only on elements that escape the document flow.

### Named Rules

**The Flat-By-Default Rule.** Cards are flat. Buttons are flat. Section bands are flat. Depth comes from `ring-1` on cards, `border` on inputs, and a single `bg-muted/30` tonal step between sections. Adding a shadow to a card or button is a brand violation, not a polish.

**The Glassmorphism Ban.** `backdrop-filter` is permitted on exactly one element: the sticky site header, which uses `backdrop-blur` against `bg-background/80` so content under it remains legible while scrolling. It is forbidden anywhere else, including cards, dialogs, hero overlays, and decorative panels.

## 5. Components

Every component is shaped by the same instinct: small radius, careful padding, an assertive focus ring, and a 1-pixel push-down on active so the click feels acknowledged.

### Buttons
- **Shape:** Lozenge with `rounded-lg` (`0.625rem` / 10px). Small (`xs`, `sm`) sizes ratchet down to `min(var(--radius-md), 10-12px)`.
- **Primary (`default` variant):** Graphite (`oklch(0.205 0 0)`) background with Drafting-Paper-on-dark (`oklch(0.985 0 0)`) text. Height `h-8` (2rem) by default; `h-9` for `lg`, `h-7` for `sm`. Padding `px-2.5` with icon-aware bumps on either side.
- **Outline:** Drafting Paper background, Pencil-Line border, Carbon text. Hovers to Paper Tint background.
- **Ghost:** No background or border at rest; hovers to Paper Tint. Used for header navigation links and tertiary actions.
- **Destructive:** Vermilion text on a 10 percent vermilion background. Never solid vermilion buttons; the soft variant keeps the action available without shouting.
- **Hover / Focus:** Hover lowers contrast 20 percent on solid variants (`bg-primary/80`), shifts to Paper Tint on transparent variants. Focus-visible draws a 3px ring at `ring/50` opacity with a matched border (`border-ring`). Focus is never removed without replacement.
- **Active:** Every button translates 1px down on `:active` (`translate-y-px`), excluding triggers that open menus (`aria-haspopup`). This is the signature confirmation gesture.
- **Disabled:** 50 percent opacity, pointer-events removed.

### Cards
- **Corner Style:** `rounded-xl` (`0.875rem` / 14px) on the outer container, `rounded-t-xl` / `rounded-b-xl` on header/footer to match.
- **Background:** Drafting Paper (light), Carbon Card (dark).
- **Shadow Strategy:** None at rest. See [Flat-By-Default Rule](#named-rules-2).
- **Border:** Ring instead of border. `ring-1 ring-foreground/10` so the line scales with text color and stays consistent in both themes.
- **Internal Padding:** `py-4 px-4` default; `py-3 px-3` for `size="sm"`. Footers get a top border in Pencil Line and Paper Tint background to mark the affordance break.

### Inputs / Fields
- **Style:** `h-8` (2rem), transparent background (`dark:bg-input/30`), Pencil-Line border, `rounded-lg`. Padding `px-2.5 py-1`.
- **Focus:** Border becomes Focus Ring color, plus a 3px outer ring at `ring/50`. No glow, no scale, no shift.
- **Invalid:** Border switches to Vermilion plus a 3px destructive ring; the focus ring is unchanged in color but matched in intensity so it stays a peer to other inputs, not a sibling that screams.
- **Disabled:** 50 percent opacity, pointer-events removed, background dims to `input/50`.

### Navigation (Site header)
- **Style:** Sticky top, full width, 56px tall (`h-14`). Background is `bg-background/80` with `backdrop-blur` (the one permitted use). Bottom border is Pencil Line.
- **Typography:** Brand mark uses Title weight on the wordmark with a 2px Graphite dot before it. Inline links are `text-xs` Specification Gray, hover to Carbon. Open-app CTA is the only Primary button in the header.
- **Mobile:** Inline links collapse below 640px; only the wordmark, theme toggle, and Open-app button remain.

### Status Pills + Stack Pills
- **Status pill** (`The hero strap, "Open source · MCP-native · Self-hosted on AWS"`): Pencil-Line border, transparent background, Specification Gray text, emerald 1.5px dot prepended. Conveys "this is real, it's running" without a chromatic button.
- **Stack pill** (architecture section): Drafting Paper background, Pencil-Line border, mono `0.7rem` Specification Gray text. One-per-tool listing of the actual stack. Wraps freely; never centered.

### Connection Diagram (signature component)
The MCP "many tools, one brain, your cloud" diagram is the signature component of the marketing surface. It is built on real SVG paths between absolutely-positioned HTML chips, sharing one coordinate system via a fixed `aspect-ratio: 800/440`. Beams are cubic Bezier paths drawn with two layers: a static rail at 12 percent opacity, and an animated overlay with a short dashed segment (`stroke-dasharray: 8 180`) that travels the path on a 3.2-second linear loop, staggered by 0.4s per index. The hub is a `rounded-2xl` card with a `ring-1 ring-primary/20`. The diagram is the page's only non-textual storytelling; do not add a second decorative SVG anywhere on the marketing surface.

### Typing-Rotate (hero strap)
A reserved-width inline span that types each phrase in at 55ms per character, holds 1.4s, deletes at 30ms per character, then advances. The cursor is a 2px-wide pulse. Width is locked to the longest phrase so the line below never jitters. Used exactly once, in the hero strap; never duplicated on the page.

## 6. Do's and Don'ts

### Do:
- **Do** keep neutrals tinted toward `chroma 0` (true achromatic). The palette's OKLCH values are canonical; reference them by name (Carbon, Graphite, Paper Tint) in code review.
- **Do** prefer `ring-1` over `border` on cards and floating chips. The ring grows from the inside and stays consistent in both themes.
- **Do** use `text-balance` on every section headline. Widow words on a marketing surface are a brand bug.
- **Do** cap body line length to `max-w-3xl` (~75ch) for prose sections.
- **Do** use the `active:translate-y-px` press signature on every interactive element. It is the system's confirmation gesture.
- **Do** show code, costs, and limitations on the landing surface itself, not behind a CTA. "PoC, not 1.0" and "Not enterprise yet" are part of the brand.
- **Do** put `prefers-reduced-motion` guards on the typing rotate and the diagram beam-flow; both should collapse to a static state when requested.
- **Do** keep mono confined to labels, code, status pills, and the typing cursor.

### Don't:
- **Don't** use gradient text (`background-clip: text` + gradient). The system has zero gradients; emphasis comes from weight and size.
- **Don't** add glassmorphism. `backdrop-filter` is allowed on the sticky header only. Never on cards, dialogs, hero overlays, or decorative panels.
- **Don't** use `border-left` or `border-right` greater than 1px as a colored stripe on cards, list items, callouts, or alerts. Full borders, full backgrounds, or nothing.
- **Don't** drop a shadow on a card, button, or static section. Cards are flat. Shadows belong only on detached overlays (toast, dropdown, dialog) and the two diagram chips.
- **Don't** use color as the sole signal for state. Pair every chromatic decision (destructive, status) with an icon or text label.
- **Don't** introduce a third chromatic color. The Ration Rule means Vermilion (destructive) and Schematic Indigo (dark-mode sidebar only). No teal, no purple, no brand-blue.
- **Don't** ship a SaaS-cream pastel hero, a three-card "Why us" grid with icons, a faux logo wall, or a "Trusted by teams at" social-proof band.
- **Don't** ship a B2B-purple "future of work" headline, AI-startup gradient-on-black aesthetic, or fintech navy-and-gold trust theatre.
- **Don't** ship the hero-metric template (big number, small label, supporting stats, gradient accent). It is the saturated SaaS cliché.
- **Don't** ship identical card grids: same-sized cards with icon + heading + text repeated four times in a row. If the four items are genuinely the same shape, vary spacing or layout.
- **Don't** reach for a modal as the first thought. Inline disclosure or a separate route is almost always the better answer.
- **Don't** write em dashes (`—`) or double-hyphen em dashes (`--`). Use commas, colons, semicolons, periods, or parentheses.
- **Don't** use emoji in product copy or marketing copy. The voice is dry; emoji break the register.
- **Don't** look generically *shadcn-starter*. Monochrome alone is not a point of view; the schematic diagrams, the typography rules, and the ration of color are.
