"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Block-level scroll-triggered reveal. Fades in plus a small upward
 * translate when the wrapped block enters the viewport. The whole
 * block animates as one unit; use this for figures, panels, and
 * other single elements that should land deliberately.
 *
 * Accessibility: when `prefers-reduced-motion: reduce` is set, the
 * content renders fully visible with no transform.
 */
export function FadeIn({
  children,
  className,
  threshold = 0.2,
  delayMs = 0,
  durationMs = 700,
  yPx = 6,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  threshold?: number;
  delayMs?: number;
  durationMs?: number;
  yPx?: number;
  as?: "div" | "section" | "figure" | "aside";
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = React.useState(false);
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
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold, reduceMotion]);

  const shouldShow = visible || reduceMotion;

  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement>}
      className={cn("will-change-[opacity,transform]", className)}
      style={{
        opacity: shouldShow ? 1 : 0,
        transform: shouldShow ? "translateY(0)" : `translateY(${yPx}px)`,
        transition: reduceMotion
          ? "none"
          : `opacity ${durationMs}ms cubic-bezier(0.25, 1, 0.5, 1) ${delayMs}ms, transform ${durationMs}ms cubic-bezier(0.25, 1, 0.5, 1) ${delayMs}ms`,
      }}
    >
      {children}
    </Tag>
  );
}
