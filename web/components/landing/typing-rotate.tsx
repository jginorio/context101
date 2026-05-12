"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Typing animation that cycles through a list of phrases. Each phrase is
 * typed in, held briefly, deleted, then the next phrase types in. The
 * surrounding text doesn't shift because we reserve max-width via the
 * longest phrase.
 *
 * Accessibility: when `prefers-reduced-motion: reduce` is set, the animation
 * is suppressed and the first phrase renders as static text. A visually
 * hidden span carries the full list to screen readers in every mode.
 */
export function TypingRotate({
  phrases,
  className,
  typingSpeedMs = 55,
  deletingSpeedMs = 30,
  holdMs = 1400,
}: {
  phrases: string[];
  className?: string;
  typingSpeedMs?: number;
  deletingSpeedMs?: number;
  holdMs?: number;
}) {
  const [index, setIndex] = React.useState(0);
  const [text, setText] = React.useState("");
  const [phase, setPhase] = React.useState<"typing" | "holding" | "deleting">(
    "typing"
  );
  const [reduceMotion, setReduceMotion] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  React.useEffect(() => {
    if (reduceMotion) return;
    const current = phrases[index];
    let timeout: ReturnType<typeof setTimeout>;

    if (phase === "typing") {
      if (text.length < current.length) {
        timeout = setTimeout(
          () => setText(current.slice(0, text.length + 1)),
          typingSpeedMs
        );
      } else {
        timeout = setTimeout(() => setPhase("holding"), 0);
      }
    } else if (phase === "holding") {
      timeout = setTimeout(() => setPhase("deleting"), holdMs);
    } else {
      if (text.length > 0) {
        timeout = setTimeout(
          () => setText(current.slice(0, text.length - 1)),
          deletingSpeedMs
        );
      } else {
        timeout = setTimeout(() => {
          setIndex((i) => (i + 1) % phrases.length);
          setPhase("typing");
        }, 0);
      }
    }

    return () => clearTimeout(timeout);
  }, [
    text,
    phase,
    index,
    phrases,
    typingSpeedMs,
    deletingSpeedMs,
    holdMs,
    reduceMotion,
  ]);

  const longest = React.useMemo(
    () => phrases.reduce((a, b) => (a.length >= b.length ? a : b), ""),
    [phrases]
  );

  // Screen-reader summary: phrases joined into one calm sentence,
  // not announced on every keystroke.
  const srSummary = phrases.join(" ");

  if (reduceMotion) {
    return (
      <span className={cn("inline-flex font-mono", className)}>
        <span className="sr-only">{srSummary}</span>
        <span aria-hidden>{phrases[0]}</span>
      </span>
    );
  }

  return (
    <span className={cn("relative inline-flex font-mono", className)}>
      <span className="sr-only">{srSummary}</span>
      <span aria-hidden className="invisible">
        {longest}
      </span>
      <span aria-hidden className="absolute inset-0">
        {text}
        <span className="ml-0.5 inline-block h-[1em] w-[2px] -translate-y-[1px] animate-pulse bg-current align-middle" />
      </span>
    </span>
  );
}
