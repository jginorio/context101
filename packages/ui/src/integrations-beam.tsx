"use client";

import * as React from "react";
import { Brain, User } from "lucide-react";

import {
  GithubLogo,
  GoogleDocsLogo,
  NotionLogo,
} from "./stack-logos";
import { AnimatedBeam } from "./animated-beam";
import { cn } from "./cn";

/**
 * "Many sources, one brain, every tool" — rendered as a Magic UI animated
 * beam. Monochrome source marks (matching the marquees) stream into the
 * Context101 hub — the one accented node — which then feeds whoever (or
 * whatever agent) is reading.
 */

const Node = React.forwardRef<
  HTMLDivElement,
  { className?: string; children?: React.ReactNode }
>(({ className, children }, ref) => (
  <div
    ref={ref}
    className={cn(
      "z-10 flex size-12 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--accent)_16%,var(--line))] bg-[color-mix(in_srgb,var(--accent-soft)_55%,var(--card))] p-3 text-foreground shadow-[0_0_24px_-12px_rgba(184,85,201,0.5)]",
      className,
    )}
  >
    {children}
  </div>
));
Node.displayName = "Node";

export function IntegrationsBeam({ className }: { className?: string }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const githubRef = React.useRef<HTMLDivElement>(null);
  const docsRef = React.useRef<HTMLDivElement>(null);
  const driveRef = React.useRef<HTMLDivElement>(null);
  const notionRef = React.useRef<HTMLDivElement>(null);
  const markdownRef = React.useRef<HTMLDivElement>(null);
  const hubRef = React.useRef<HTMLDivElement>(null);
  const agentRef = React.useRef<HTMLDivElement>(null);

  const sources = [githubRef, docsRef, driveRef, notionRef, markdownRef];

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex h-[460px] w-full items-center justify-center overflow-hidden sm:h-[400px]",
        className,
      )}
    >
      <div className="flex size-full max-w-2xl flex-col items-stretch justify-between gap-10 sm:flex-row">
        {/* Sources */}
        <div className="flex flex-row justify-center gap-3 sm:flex-col sm:gap-4">
          <Node ref={githubRef}>
            <GithubLogo className="size-full" />
          </Node>
          <Node ref={docsRef}>
            <GoogleDocsLogo className="size-full" />
          </Node>
          <Node ref={driveRef}>
            <GoogleDriveMark />
          </Node>
          <Node ref={notionRef}>
            <NotionLogo className="size-full" />
          </Node>
          <Node ref={markdownRef}>
            <MarkdownMark />
          </Node>
        </div>

        {/* Context101 hub */}
        <div className="flex flex-col items-center justify-center">
          <Node
            ref={hubRef}
            className="size-16 border-0 bg-[linear-gradient(165deg,var(--brain)_0%,var(--brain-2)_100%)] p-0 text-white shadow-[0_0_36px_-6px_rgba(184,85,201,0.7)] ring-2 ring-white/15"
          >
            <Brain className="size-7" />
          </Node>
        </div>

        {/* Whoever is reading */}
        <div className="flex flex-col items-center justify-center">
          <Node ref={agentRef}>
            <User className="size-5" />
          </Node>
        </div>
      </div>

      {/* Sources -> hub */}
      {sources.map((ref, i) => (
        <AnimatedBeam
          key={i}
          containerRef={containerRef}
          fromRef={ref}
          toRef={hubRef}
          pathType="elbow"
          gradientStartColor="#b855c9"
          gradientStopColor="#8b5cf6"
          pathColor="#a89eb4"
          pathOpacity={0.12}
          delay={i * 0.6}
          duration={7}
        />
      ))}

      {/* Hub -> reader */}
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={hubRef}
        toRef={agentRef}
        gradientStartColor="#b855c9"
        gradientStopColor="#8b5cf6"
        pathColor="#a89eb4"
        pathOpacity={0.12}
        duration={7}
      />
    </div>
  );
}

/* ── Monochrome source marks (currentColor) ────────────────────────── */

function GoogleDriveMark() {
  return (
    <svg viewBox="0 0 87.3 78" fill="currentColor" aria-hidden className="size-full">
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" />
      <path d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44A9.06 9.06 0 0 0 0 53h27.5z" />
      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75L86.1 57.5c.8-1.4 1.2-2.95 1.2-4.5H59.798l5.852 11.5z" />
      <path d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" />
      <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" />
    </svg>
  );
}

function MarkdownMark() {
  return (
    <svg viewBox="0 0 208 128" fill="currentColor" aria-hidden className="size-full">
      <path
        fillRule="evenodd"
        d="M15 10a5 5 0 0 0-5 5v98a5 5 0 0 0 5 5h178a5 5 0 0 0 5-5V15a5 5 0 0 0-5-5zM0 15A15 15 0 0 1 15 0h178a15 15 0 0 1 15 15v98a15 15 0 0 1-15 15H15a15 15 0 0 1-15-15z"
        clipRule="evenodd"
      />
      <path d="M30 98V30h20l20 25 20-25h20v68H90V59L70 84 50 59v39zm125 0-30-33h20V30h20v35h20z" />
    </svg>
  );
}
