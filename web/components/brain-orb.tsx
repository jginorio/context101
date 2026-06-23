"use client";

import * as React from "react";

import { BRAIN_ACCENT_RGB } from "@/lib/brain-accent";

/**
 * A miniature, ambient version of the marketing hero's BrainGlobe, tuned for
 * the sidebar's active-brain tile: far fewer nodes (legible at ~36px), a very
 * slow idle rotation so it never pulls focus, and no pointer interaction (the
 * tile is a dropdown trigger). Respects prefers-reduced-motion by rendering a
 * single static frame.
 */

type Vec3 = { x: number; y: number; z: number };

// Hero's BrainGlobe geometry, thinned out for the small tile: fewer nodes so
// it doesn't turn to mush at ~36px, but the same nearest-neighbor wiring so it
// still reads as a rotating neuron network.
const NODE_COUNT = 90;
const MAX_NEIGHBORS = 3;
const LINK_DISTANCE = 0.56;
// Idle spin — slower than the hero (~0.0022) but fast enough to clearly turn.
const IDLE_SPIN = 0.0014;

function fibonacciSphere(count: number): Vec3[] {
  const points: Vec3[] = [];
  const offset = 2 / count;
  const increment = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = i * offset - 1 + offset / 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * increment;
    const wobble = 0.9 + 0.18 * Math.sin(i * 12.9898) * Math.cos(i * 4.1414);
    points.push({
      x: Math.cos(phi) * radius * wobble,
      y: y * wobble,
      z: Math.sin(phi) * radius * wobble,
    });
  }
  return points;
}

function buildLinks(points: Vec3[]): [number, number][] {
  const links: [number, number][] = [];
  const seen = new Set<string>();
  for (let i = 0; i < points.length; i++) {
    const dists: { j: number; d: number }[] = [];
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      const dz = points[i].z - points[j].z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < LINK_DISTANCE) dists.push({ j, d });
    }
    dists.sort((a, b) => a.d - b.d);
    for (const { j } of dists.slice(0, MAX_NEIGHBORS)) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push([i, j]);
    }
  }
  return links;
}

// Computed once for the module — the geometry is deterministic and shared.
const POINTS = fibonacciSphere(NODE_COUNT);
const LINKS = buildLinks(POINTS);

export function BrainOrb({ className }: { className?: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let width = 0;
    let height = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let rotY = 0.6;
    const rotX = -0.32;

    const projected = POINTS.map(() => ({ x: 0, y: 0, depth: 0, scale: 0 }));

    const draw = () => {
      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(width, height) * 0.4;
      const focal = 2.6;

      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);

      for (let i = 0; i < POINTS.length; i++) {
        const p = POINTS[i];
        const x1 = p.x * cosY - p.z * sinY;
        const z1 = p.x * sinY + p.z * cosY;
        const y1 = p.y * cosX - z1 * sinX;
        const z2 = p.y * sinX + z1 * cosX;
        const perspective = focal / (focal - z2);
        projected[i].x = cx + x1 * radius * perspective;
        projected[i].y = cy + y1 * radius * perspective;
        projected[i].depth = z2;
        projected[i].scale = perspective;
      }

      ctx.clearRect(0, 0, width, height);

      for (let k = 0; k < LINKS.length; k++) {
        const a = projected[LINKS[k][0]];
        const b = projected[LINKS[k][1]];
        const depth = (a.depth + b.depth) / 2;
        const t = (depth + 1.2) / 2.4;
        const alpha = 0.05 + Math.max(0, t) * 0.3;
        ctx.strokeStyle = `rgba(${BRAIN_ACCENT_RGB}, ${alpha})`;
        ctx.lineWidth = 0.3 + t * 0.35;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      const order = projected
        .map((_, i) => i)
        .sort((i, j) => projected[i].depth - projected[j].depth);
      for (const i of order) {
        const node = projected[i];
        const t = (node.depth + 1.2) / 2.4;
        const r = (0.45 + Math.max(0, t) * 1.05) * node.scale;
        const coreAlpha = 0.25 + Math.max(0, t) * 0.6;

        const glow = ctx.createRadialGradient(
          node.x,
          node.y,
          0,
          node.x,
          node.y,
          r * 3.2
        );
        glow.addColorStop(0, `rgba(${BRAIN_ACCENT_RGB}, ${coreAlpha * 0.5})`);
        glow.addColorStop(1, `rgba(${BRAIN_ACCENT_RGB}, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r * 3.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(${BRAIN_ACCENT_RGB}, ${coreAlpha})`;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    if (reduceMotion) {
      draw();
      return () => ro.disconnect();
    }

    let raf = 0;
    const render = () => {
      raf = requestAnimationFrame(render);
      rotY += IDLE_SPIN;
      draw();
    };
    render();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ pointerEvents: "none" }}
      aria-hidden
    />
  );
}
