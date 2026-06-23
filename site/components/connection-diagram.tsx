"use client";

import * as React from "react";
import {
  Brain,
  Code2,
  FileCode,
  MessageSquare,
  Terminal,
  TerminalSquare,
} from "lucide-react";

import {
  GithubLogo,
  GoogleDocsLogo,
  NotionLogo,
} from "@context101/ui/stack-logos";
import { cn } from "@/lib/utils";

/**
 * The "many sources, one brain, many tools" diagram.
 *
 * Reads left-to-right matching the actual data flow: sources feed
 * Context101, which serves any MCP-compatible agent.
 *
 * Two layouts share the same node data:
 *
 *   sm and up: a horizontal schematic. Four source categories on the
 *   left, the Context101 hub in the middle, four agents on the right;
 *   cubic Bezier beams travel between them with an animated dashed stroke.
 *
 *   below sm: a vertical schematic. Full-width chips stack top to
 *   bottom — sources, hub, then agents — preserving the data-flow
 *   narrative.
 */

type Side = "left" | "right";
type Status = "ready" | "soon";

type Node = {
  id: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** percent positions inside the horizontal container */
  x: number;
  y: number;
  side: Side;
  status?: Status; // default "ready"
};

const VIEW_W = 800;
const VIEW_H = 280;

// Left column: the kinds of sources Context101 ingests from. Kept
// general — a handful of categories instead of every individual
// connector — so the topology stays compact and easy to read.
const LEFT_NODES: Node[] = [
  {
    id: "notion",
    label: "Notion & wikis",
    Icon: NotionLogo,
    x: 4,
    y: 14,
    side: "left",
  },
  {
    id: "workspace",
    label: "Google Workspace",
    Icon: GoogleDocsLogo,
    x: 4,
    y: 34,
    side: "left",
  },
  {
    id: "github",
    label: "Code & repos",
    Icon: GithubLogo,
    x: 4,
    y: 54,
    side: "left",
  },
  {
    id: "files",
    label: "Docs & files",
    Icon: FileCode,
    x: 4,
    y: 74,
    side: "left",
  },
];

// Right column: MCP-compatible agents that retrieve from the brain.
// Kept to four to mirror the source column and stay compact.
const RIGHT_NODES: Node[] = [
  { id: "cursor", label: "Cursor", Icon: Code2, x: 76, y: 14, side: "right" },
  {
    id: "code",
    label: "Claude Code",
    Icon: Terminal,
    x: 76,
    y: 34,
    side: "right",
  },
  {
    id: "desktop",
    label: "Claude Desktop",
    Icon: MessageSquare,
    x: 76,
    y: 54,
    side: "right",
  },
  {
    id: "custom",
    label: "Your agent",
    Icon: TerminalSquare,
    x: 76,
    y: 74,
    side: "right",
  },
];

const HUB = { x: 38, y: 48, w: 24, h: 22 }; // percent

/** Convert percent-positioned node to SVG path endpoints (in viewBox units). */
function rightEdgeOf(n: Node) {
  // node box width is ~20% wide, anchor at right edge midline
  const cxPct = n.x + 20;
  const cyPct = n.y + 5; // small offset to anchor in the middle of the box
  return { x: (cxPct / 100) * VIEW_W, y: (cyPct / 100) * VIEW_H };
}
function leftEdgeOf(n: Node) {
  const cxPct = n.x;
  const cyPct = n.y + 5;
  return { x: (cxPct / 100) * VIEW_W, y: (cyPct / 100) * VIEW_H };
}
function hubAnchor(side: Side) {
  const x = side === "left" ? HUB.x : HUB.x + HUB.w;
  const y = HUB.y + HUB.h / 2;
  return { x: (x / 100) * VIEW_W, y: (y / 100) * VIEW_H };
}

function bezier(from: { x: number; y: number }, to: { x: number; y: number }) {
  const dx = (to.x - from.x) * 0.55;
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
}

export function ConnectionDiagram({ className }: { className?: string }) {
  return (
    <>
      <ConnectionDiagramVertical className={cn("sm:hidden", className)} />
      <ConnectionDiagramHorizontal
        className={cn("hidden sm:block", className)}
      />
      <BeamStyles />
    </>
  );
}

/* ── Horizontal (sm and up) ───────────────────────────────────────── */

function ConnectionDiagramHorizontal({ className }: { className?: string }) {
  // Pre-compute paths once: each entry remembers whether it should pulse
  // so the render loop below stays declarative.
  const leftPaths = React.useMemo(
    () =>
      LEFT_NODES.map((n) => ({
        d: bezier(rightEdgeOf(n), hubAnchor("left")),
        animated: true,
      })),
    [],
  );
  const rightPaths = React.useMemo(
    () =>
      RIGHT_NODES.map((n) => ({
        d: bezier(hubAnchor("right"), leftEdgeOf(n)),
        animated: (n.status ?? "ready") === "ready",
      })),
    [],
  );
  const allPaths = [...leftPaths, ...rightPaths];
  const animatedPaths = allPaths.filter((p) => p.animated);

  return (
    <div
      className={cn(
        "relative w-full",
        // Lock aspect ratio so the SVG and the HTML nodes share coordinates.
        "[aspect-ratio:800/280]",
        className,
      )}
    >
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <defs>
          <linearGradient id="beam-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
            <stop offset="50%" stopColor="currentColor" stopOpacity="1" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Faint always-on rails so the topology reads even before motion starts. */}
        {allPaths.map((p, i) => (
          <path
            key={`rail-${i}`}
            d={p.d}
            fill="none"
            stroke="currentColor"
            strokeOpacity={p.animated ? 0.12 : 0.07}
            strokeWidth={1.5}
            strokeDasharray={p.animated ? undefined : "3 5"}
            className="text-foreground"
          />
        ))}

        {/* Animated dash overlay — only for "ready" connections so the
            "soon" sources visually read as not-yet-live. */}
        {animatedPaths.map((p, i) => (
          <path
            key={`beam-${i}`}
            d={p.d}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            className="ctx-beam-flow text-primary [stroke-dasharray:8_180]"
            style={{ animationDelay: `${(i % 4) * 0.4}s` }}
          />
        ))}
      </svg>

      {/* Left column: tools */}
      {LEFT_NODES.map((n) => (
        <NodeChipAbsolute key={n.id} node={n} align="left" />
      ))}

      {/* Right column: data sources */}
      {RIGHT_NODES.map((n) => (
        <NodeChipAbsolute key={n.id} node={n} align="right" />
      ))}

      {/* Center hub */}
      <div
        className="absolute flex flex-col items-center justify-center rounded-2xl border border-[color-mix(in_srgb,var(--accent)_14%,var(--line))] bg-[linear-gradient(165deg,color-mix(in_srgb,var(--accent-soft)_48%,var(--card))_0%,var(--card)_100%)] text-card-foreground shadow-sm ring-1 ring-primary/15"
        style={{
          left: `${HUB.x}%`,
          top: `${HUB.y}%`,
          width: `${HUB.w}%`,
          height: `${HUB.h}%`,
        }}
      >
        <div className="flex items-center gap-2">
          <Brain className="size-5 text-primary" />
          <span className="font-semibold text-sm">Context101</span>
        </div>
        <span className="mt-1 text-[10px] text-muted-foreground font-mono">
          MCP · Semantic search
        </span>
      </div>
    </div>
  );
}

function NodeChipAbsolute({
  node,
  align,
}: {
  node: Node;
  align: "left" | "right";
}) {
  const { Icon, label } = node;
  const isSoon = node.status === "soon";
  return (
    <div
      className={cn(
        "absolute flex items-center gap-2 rounded-lg border bg-background/80 px-2.5 py-1.5 text-xs shadow-sm backdrop-blur-sm",
        // ~20% wide so SVG endpoints line up; height auto.
        "w-[20%] min-w-0",
        isSoon && "opacity-60",
      )}
      style={{ left: `${node.x}%`, top: `${node.y}%` }}
      title={isSoon ? `${label} (coming soon)` : label}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span
        className={cn("truncate flex-1", align === "right" ? "text-right" : "")}
      >
        {label}
      </span>
      {isSoon ? (
        <span
          className={cn(
            "shrink-0 rounded-sm border border-dashed px-1 py-px text-[8px] font-medium text-muted-foreground",
            "leading-none",
          )}
        >
          Soon
        </span>
      ) : null}
    </div>
  );
}

/* ── Vertical (below sm) ──────────────────────────────────────────── */

function ConnectionDiagramVertical({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col items-stretch gap-5", className)}>
      <NodeColumn nodes={LEFT_NODES} />
      <VerticalBeam />
      <Hub />
      <VerticalBeam />
      <NodeColumn nodes={RIGHT_NODES} />
    </div>
  );
}

function NodeColumn({ nodes }: { nodes: Node[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {nodes.map((n) => {
        const { Icon, label } = n;
        const isSoon = n.status === "soon";
        return (
          <li
            key={n.id}
            className={cn(
              "flex items-center gap-2.5 rounded-lg border bg-background/80 px-3 py-2 text-sm shadow-sm",
              isSoon && "opacity-60",
            )}
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate flex-1">{label}</span>
            {isSoon ? (
              <span className="shrink-0 rounded-sm border border-dashed px-1.5 py-px text-[9px] font-medium text-muted-foreground leading-none">
                Soon
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function Hub() {
  return (
    <div className="mx-auto flex w-full max-w-[16rem] flex-col items-center justify-center rounded-2xl border border-[color-mix(in_srgb,var(--accent)_14%,var(--line))] bg-[linear-gradient(165deg,color-mix(in_srgb,var(--accent-soft)_48%,var(--card))_0%,var(--card)_100%)] px-4 py-4 text-card-foreground shadow-sm ring-1 ring-primary/15">
      <div className="flex items-center gap-2">
        <Brain className="size-5 text-primary" />
        <span className="font-semibold text-sm">Context101</span>
      </div>
      <span className="mt-1 text-[10px] text-muted-foreground font-mono">
        MCP · Semantic search
      </span>
    </div>
  );
}

function VerticalBeam() {
  return (
    <svg
      width="2"
      height="36"
      viewBox="0 0 2 36"
      className="mx-auto block"
      aria-hidden
    >
      <path
        d="M 1 0 L 1 36"
        stroke="currentColor"
        strokeOpacity={0.12}
        strokeWidth={1.5}
        fill="none"
        className="text-foreground"
      />
      <path
        d="M 1 0 L 1 36"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
        className="ctx-beam-flow-vertical text-primary [stroke-dasharray:4_28]"
      />
    </svg>
  );
}

/* ── Shared inline styles ─────────────────────────────────────────── */

function BeamStyles() {
  return (
    <style>{`
      @keyframes ctx-beam-flow-horizontal {
        0%   { stroke-dashoffset: 188; }
        100% { stroke-dashoffset: 0;   }
      }
      @keyframes ctx-beam-flow-vertical {
        0%   { stroke-dashoffset: 32; }
        100% { stroke-dashoffset: 0;  }
      }
      .ctx-beam-flow { animation: ctx-beam-flow-horizontal 3.2s linear infinite; }
      .ctx-beam-flow-vertical { animation: ctx-beam-flow-vertical 2.2s linear infinite; }
      @media (prefers-reduced-motion: reduce) {
        .ctx-beam-flow,
        .ctx-beam-flow-vertical { animation: none; }
      }
    `}</style>
  );
}
