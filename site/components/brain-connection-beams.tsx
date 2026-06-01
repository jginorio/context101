"use client";

import { BRAIN_ACCENT } from "@/lib/brain-accent";

type Node = { id: string; cx: number; cy: number; r?: number };

const NODES: Node[] = [
  { id: "n1", cx: 140, cy: 120, r: 3 },
  { id: "n2", cx: 280, cy: 80, r: 2.5 },
  { id: "n3", cx: 420, cy: 160, r: 3.5 },
  { id: "n4", cx: 620, cy: 90, r: 2.5 },
  { id: "n5", cx: 980, cy: 140, r: 3 },
  { id: "n6", cx: 1060, cy: 260, r: 2 },
  { id: "n7", cx: 90, cy: 320, r: 2.5 },
  { id: "n8", cx: 240, cy: 420, r: 3 },
  { id: "n9", cx: 520, cy: 360, r: 2 },
  { id: "n10", cx: 760, cy: 480, r: 3.5 },
  { id: "n11", cx: 980, cy: 540, r: 2.5 },
  { id: "n12", cx: 1120, cy: 620, r: 2 },
  { id: "n13", cx: 180, cy: 640, r: 2.5 },
  { id: "n14", cx: 1080, cy: 80, r: 2 },
];

const LINKS: [string, string][] = [
  ["n1", "n2"],
  ["n2", "n3"],
  ["n3", "n4"],
  ["n4", "n5"],
  ["n5", "n6"],
  ["n1", "n7"],
  ["n7", "n8"],
  ["n8", "n9"],
  ["n9", "n10"],
  ["n10", "n11"],
  ["n11", "n12"],
  ["n7", "n13"],
  ["n4", "n14"],
  ["n3", "n9"],
  ["n8", "n13"],
  ["n5", "n10"],
  ["n2", "n7"],
  ["n6", "n11"],
];

function node(id: string) {
  const n = NODES.find((x) => x.id === id);
  if (!n) throw new Error(`missing node ${id}`);
  return n;
}

function synapsePath(a: Node, b: Node) {
  const mx = (a.cx + b.cx) / 2;
  const my = (a.cy + b.cy) / 2;
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const cx = mx - dy * 0.18;
  const cy = my + dx * 0.18;
  return `M ${a.cx} ${a.cy} Q ${cx} ${cy} ${b.cx} ${b.cy}`;
}

export function BrainConnectionBeams() {
  return (
    <svg
      className="brain-beams pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <defs>
        <radialGradient id="synapse-glow" cx="50%" cy="35%" r="70%">
          <stop offset="0%" stopColor={BRAIN_ACCENT} stopOpacity="0.11" />
          <stop offset="100%" stopColor={BRAIN_ACCENT} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1200" height="800" fill="url(#synapse-glow)" />
      {LINKS.map(([from, to], i) => (
        <path
          key={`${from}-${to}`}
          d={synapsePath(node(from), node(to))}
          fill="none"
          stroke={BRAIN_ACCENT}
          strokeWidth="1.25"
          strokeLinecap="round"
          opacity={0.28 + (i % 3) * 0.08}
          className="brain-beams__link"
          style={{ animationDelay: `${i * 0.35}s` }}
        />
      ))}
      {NODES.map((n) => (
        <g key={n.id}>
          <circle
            cx={n.cx}
            cy={n.cy}
            r={(n.r ?? 2.5) * 2.2}
            fill={BRAIN_ACCENT}
            opacity={0.06}
            className="brain-beams__pulse"
          />
          <circle
            cx={n.cx}
            cy={n.cy}
            r={n.r ?? 2.5}
            fill={BRAIN_ACCENT}
            opacity={0.58}
          />
        </g>
      ))}
    </svg>
  );
}
