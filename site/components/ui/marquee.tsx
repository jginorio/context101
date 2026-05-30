import * as React from "react";

/**
 * Lightweight, dependency-free marquee. Renders `repeat` identical rows in a
 * masked, overflow-hidden track and scrolls them with a CSS keyframe, so the
 * loop is seamless and works on any width (no wrapping on mobile).
 *
 * Tune via CSS vars on `className`, e.g. `[--duration:34s] [--gap:3rem]`.
 */
export function Marquee({
  children,
  repeat = 4,
  reverse = false,
  pauseOnHover = true,
  className = "",
}: {
  children: React.ReactNode;
  repeat?: number;
  reverse?: boolean;
  pauseOnHover?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`marquee-wrap ${className}`}
      data-pause={pauseOnHover ? "true" : undefined}
    >
      {Array.from({ length: repeat }).map((_, i) => (
        <div
          key={i}
          className="marquee-row"
          data-reverse={reverse ? "true" : undefined}
          aria-hidden={i > 0}
        >
          {children}
        </div>
      ))}
    </div>
  );
}
