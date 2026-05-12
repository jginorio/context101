"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Typing animation that cycles through a list of phrases. Each phrase is
 * typed in, held briefly, deleted, then the next phrase types in. Designed
 * to be drop-in for the hero — the surrounding text doesn't shift because
 * we reserve max-width via the longest phrase.
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

  React.useEffect(() => {
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
        setIndex((i) => (i + 1) % phrases.length);
        setPhase("typing");
      }
    }

    return () => clearTimeout(timeout);
  }, [text, phase, index, phrases, typingSpeedMs, deletingSpeedMs, holdMs]);

  // Longest phrase reserves width so the line below doesn't jitter.
  const longest = React.useMemo(
    () => phrases.reduce((a, b) => (a.length >= b.length ? a : b), ""),
    [phrases]
  );

  return (
    <span className={cn("relative inline-flex font-mono", className)}>
      <span aria-hidden className="invisible">
        {longest}
      </span>
      <span className="absolute inset-0">
        {text}
        <span className="ml-0.5 inline-block h-[1em] w-[2px] -translate-y-[1px] animate-pulse bg-current align-middle" />
      </span>
    </span>
  );
}
