"use client";

import * as React from "react";
import {
  Bot,
  Brain,
  Code2,
  Database,
  HardDrive,
  MessageSquare,
  Terminal,
  TerminalSquare,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The "many tools, one brain, your cloud" diagram.
 *
 * Layout: 5 tool nodes on the left → Context101 hub in the middle →
 * 2 backend nodes on the right. The SVG layer underneath draws cubic
 * Bezier paths between them and animates a dashed gradient stroke
 * along each path with pure CSS (no framer-motion dependency).
 *
 * Aspect ratio is fixed via the container, so the SVG viewBox and the
 * absolutely-positioned HTML nodes share a coordinate system and stay
 * aligned at every screen size.
 */

type Side = "left" | "right";

type Node = {
  id: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** percent positions inside the container */
  x: number;
  y: number;
  side: Side;
};

const VIEW_W = 800;
const VIEW_H = 440;

const LEFT_NODES: Node[] = [
  { id: "cursor",   label: "Cursor",          Icon: Code2,          x: 4,  y: 8,  side: "left" },
  { id: "code",     label: "Claude Code",     Icon: Terminal,       x: 4,  y: 28, side: "left" },
  { id: "desktop",  label: "Claude Desktop",  Icon: MessageSquare,  x: 4,  y: 48, side: "left" },
  { id: "devin",    label: "Devin",           Icon: Bot,            x: 4,  y: 68, side: "left" },
  { id: "custom",   label: "Your agent",      Icon: TerminalSquare, x: 4,  y: 88, side: "left" },
];

const RIGHT_NODES: Node[] = [
  { id: "kb",   label: "Bedrock KB",  Icon: Database,  x: 76, y: 30, side: "right" },
  { id: "s3",   label: "S3 + sources", Icon: HardDrive, x: 76, y: 66, side: "right" },
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

function bezier(
  from: { x: number; y: number },
  to: { x: number; y: number }
) {
  const dx = (to.x - from.x) * 0.55;
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
}

export function ConnectionDiagram({ className }: { className?: string }) {
  const leftPaths = React.useMemo(
    () =>
      LEFT_NODES.map((n) => bezier(rightEdgeOf(n), hubAnchor("left"))),
    []
  );
  const rightPaths = React.useMemo(
    () =>
      RIGHT_NODES.map((n) => bezier(hubAnchor("right"), leftEdgeOf(n))),
    []
  );

  return (
    <div
      className={cn(
        "relative w-full",
        // Lock aspect ratio so the SVG and the HTML nodes share coordinates.
        "[aspect-ratio:800/440]",
        className
      )}
    >
      {/* Beams */}
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
        {[...leftPaths, ...rightPaths].map((d, i) => (
          <path
            key={`rail-${i}`}
            d={d}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.12}
            strokeWidth={1.5}
            className="text-foreground"
          />
        ))}

        {/* Animated dash overlay — a short dash travels the otherwise-invisible stroke. */}
        {[...leftPaths, ...rightPaths].map((d, i) => (
          <path
            key={`beam-${i}`}
            d={d}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            className="text-primary [animation:beam-flow_3.2s_linear_infinite] [stroke-dasharray:8_180]"
            style={{ animationDelay: `${(i % 5) * 0.4}s` }}
          />
        ))}
      </svg>

      {/* Inline keyframes so we don't depend on a global stylesheet edit. */}
      <style>{`
        @keyframes beam-flow {
          0%   { stroke-dashoffset: 188; }
          100% { stroke-dashoffset: 0;   }
        }
      `}</style>

      {/* Left column — tools */}
      {LEFT_NODES.map((n) => (
        <NodeChip key={n.id} node={n} align="left" />
      ))}

      {/* Right column — backends */}
      {RIGHT_NODES.map((n) => (
        <NodeChip key={n.id} node={n} align="right" />
      ))}

      {/* Center hub */}
      <div
        className="absolute flex flex-col items-center justify-center rounded-2xl border bg-card text-card-foreground shadow-sm ring-1 ring-primary/20"
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
          MCP · Bedrock KB
        </span>
      </div>
    </div>
  );
}

function NodeChip({
  node,
  align,
}: {
  node: Node;
  align: "left" | "right";
}) {
  const { Icon, label } = node;
  return (
    <div
      className={cn(
        "absolute flex items-center gap-2 rounded-lg border bg-background/80 px-2.5 py-1.5 text-xs shadow-sm backdrop-blur-sm",
        // ~20% wide so SVG endpoints line up; height auto.
        "w-[20%] min-w-0"
      )}
      style={{ left: `${node.x}%`, top: `${node.y}%` }}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className={cn("truncate", align === "right" ? "text-right" : "")}>
        {label}
      </span>
    </div>
  );
}
