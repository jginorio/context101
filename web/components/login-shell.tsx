"use client";

import * as React from "react";
import { Brain } from "lucide-react";

import Aurora from "@/components/Aurora";
import BlurText from "@/components/BlurText";
import { BrainConnectionBeams } from "@/components/brain-connection-beams";
import { ThemeToggle } from "@/components/theme-toggle";
import { BRAIN_ACCENT } from "@/lib/brain-accent";

export function LoginShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-4 sm:p-6">
      <div className="pointer-events-none absolute inset-0 bg-background" aria-hidden />
      <BrainConnectionBeams />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[min(60vh,520px)] opacity-45 dark:opacity-65">
        <Aurora
          amplitude={0.85}
          blend={0.45}
          speed={0.35}
          colorStops={["#d946ef", "#a855f7", "#120812"]}
        />
      </div>
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,var(--background)_85%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(to_right,oklch(0.5_0_0/0.06)_1px,transparent_1px),linear-gradient(to_bottom,oklch(0.5_0_0/0.06)_1px,transparent_1px)] [background-size:3rem_3rem]"
        aria-hidden
      />

      <div className="absolute right-4 top-4 z-20 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>

      <div className="relative z-10 w-full max-w-[420px]">
        <div className="mb-8 text-center">
          <div
            className="mx-auto mb-4 flex size-11 items-center justify-center rounded-2xl border border-border/60 bg-card/70 shadow-lg backdrop-blur-sm"
            style={{ boxShadow: `0 0 28px rgba(217, 70, 239, 0.22)` }}
          >
            <Brain className="size-5" style={{ color: BRAIN_ACCENT }} aria-hidden />
          </div>
          <BlurText
            text="Context101"
            animateBy="letters"
            delay={35}
            className="justify-center text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
            direction="bottom"
            stepDuration={0.4}
          />
          <BlurText
            text="Shared team knowledge for every AI tool"
            animateBy="words"
            delay={60}
            className="mt-3 justify-center text-sm text-muted-foreground sm:text-[15px]"
            direction="bottom"
            stepDuration={0.35}
          />
        </div>
        {children}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Sign in to browse docs, manage sources, and review suggestions.
        </p>
      </div>
    </main>
  );
}
