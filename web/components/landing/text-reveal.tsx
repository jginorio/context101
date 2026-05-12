"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Scroll-triggered text reveal. Splits the children string into words and
 * fades them in one at a time as the block enters the viewport. Use sparingly
 * — one or two moments per page, not every heading.
 */
export function TextReveal({
  children,
  className,
  as: Tag = "p",
  delayStepMs = 35,
  threshold = 0.25,
}: {
  children: string;
  className?: string;
  as?: "p" | "h1" | "h2" | "h3" | "span" | "div";
  delayStepMs?: number;
  threshold?: number;
}) {
  const ref = React.useRef<HTMLElement | null>(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
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
  }, [threshold]);

  const words = children.split(" ");

  return (
    <Tag
      ref={ref as React.Ref<HTMLHeadingElement & HTMLParagraphElement & HTMLDivElement & HTMLSpanElement>}
      className={cn(className)}
    >
      {words.map((word, i) => (
        <span
          key={i}
          className={cn(
            "inline-block transition-all duration-700 ease-out will-change-[opacity,transform]",
            visible
              ? "translate-y-0 opacity-100"
              : "translate-y-2 opacity-0"
          )}
          style={{ transitionDelay: visible ? `${i * delayStepMs}ms` : "0ms" }}
        >
          {word}
          {i < words.length - 1 && " "}
        </span>
      ))}
    </Tag>
  );
}
