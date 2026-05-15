"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Tween a number from 0 to `to` over `durationMs` when the element first
 * enters the viewport. Honors prefers-reduced-motion by rendering the
 * final value immediately. The value is rendered with `tabular-nums` so
 * digits don't shift width during the tween.
 */
export function Counter({
  to,
  durationMs = 1200,
  prefix = "",
  suffix = "",
  className,
  format = (n) => Math.round(n).toLocaleString(),
}: {
  to: number;
  durationMs?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  format?: (n: number) => string;
}) {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const [value, setValue] = React.useState(0);
  const [reduceMotion, setReduceMotion] = React.useState(false);
  const startedRef = React.useRef(false);

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
    const el = ref.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || startedRef.current) return;
        startedRef.current = true;
        obs.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / durationMs);
          // ease-out cubic
          const eased = 1 - Math.pow(1 - t, 3);
          setValue(to * eased);
          if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [to, durationMs, reduceMotion]);

  const displayed = reduceMotion ? to : value;

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {prefix}
      {format(displayed)}
      {suffix}
    </span>
  );
}
