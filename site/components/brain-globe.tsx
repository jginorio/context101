"use client";

import * as React from "react";

import { BRAIN_ACCENT_RGB } from "@/lib/brain-accent";

type Vec3 = { x: number; y: number; z: number };

const NODE_COUNT = 320;
const MAX_NEIGHBORS = 3;
const LINK_DISTANCE = 0.42;

/**
 * Brain-themed take on a hero globe: instead of a clean dotted world map, points
 * are scattered on a slightly irregular sphere and wired to their nearest
 * neighbors so the surface reads like a network of neurons / synapses. It auto
 * rotates, reacts to pointer drag, and respects prefers-reduced-motion.
 */
function fibonacciSphere(count: number): Vec3[] {
  const points: Vec3[] = [];
  const offset = 2 / count;
  const increment = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = i * offset - 1 + offset / 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * increment;
    // Pseudo-random per-index wobble keeps the shape organic (brain-like)
    // while staying deterministic so links don't flicker between frames.
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

export function BrainGlobe({ className }: { className?: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const points = fibonacciSphere(NODE_COUNT);
    const links = buildLinks(points);

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

    // Rotation state.
    let rotY = 0;
    let rotX = -0.35;
    let velY = reduceMotion ? 0 : 0.0022;
    let velX = 0;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      velY = dx * 0.00035;
      velX = dy * 0.00035;
      rotY += dx * 0.005;
      rotX += dy * 0.005;
    };
    const onPointerUp = (e: PointerEvent) => {
      dragging = false;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore — pointer may already be released
      }
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerUp);

    const projected = new Array(points.length).fill(0).map(() => ({
      x: 0,
      y: 0,
      depth: 0,
      scale: 0,
    }));

    let raf = 0;
    const render = () => {
      raf = requestAnimationFrame(render);

      if (!dragging) {
        // Ease back toward a gentle idle spin.
        velY += (0.0022 - velY) * 0.02;
        velX += -velX * 0.05;
        if (reduceMotion) {
          velY = 0;
          velX = 0;
        }
      }
      rotY += velY;
      rotX += velX;
      rotX = Math.max(-0.9, Math.min(0.9, rotX));

      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(width, height) * 0.42;
      const focal = 2.6;

      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);

      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        // Rotate around Y, then X.
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

      // Synapse links — fade with depth so the back of the brain recedes.
      for (let k = 0; k < links.length; k++) {
        const a = projected[links[k][0]];
        const b = projected[links[k][1]];
        const depth = (a.depth + b.depth) / 2;
        const t = (depth + 1.2) / 2.4;
        const alpha = 0.05 + Math.max(0, t) * 0.32;
        ctx.strokeStyle = `rgba(${BRAIN_ACCENT_RGB}, ${alpha})`;
        ctx.lineWidth = 0.6 + t * 0.6;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      // Neuron nodes — draw back-to-front for correct overlap.
      const order = projected
        .map((_, i) => i)
        .sort((i, j) => projected[i].depth - projected[j].depth);
      for (const i of order) {
        const node = projected[i];
        const t = (node.depth + 1.2) / 2.4;
        const r = (0.7 + Math.max(0, t) * 1.9) * node.scale;
        const coreAlpha = 0.25 + Math.max(0, t) * 0.6;

        const glow = ctx.createRadialGradient(
          node.x,
          node.y,
          0,
          node.x,
          node.y,
          r * 4
        );
        glow.addColorStop(0, `rgba(${BRAIN_ACCENT_RGB}, ${coreAlpha * 0.5})`);
        glow.addColorStop(1, `rgba(${BRAIN_ACCENT_RGB}, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r * 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(${BRAIN_ACCENT_RGB}, ${coreAlpha})`;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    render();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerUp);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ touchAction: "none", cursor: "grab" }}
      aria-hidden
    />
  );
}
