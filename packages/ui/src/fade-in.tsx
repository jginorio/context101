import type * as React from "react";

export function FadeIn({
  children,
  className,
  delayMs = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delayMs?: number;
}) {
  return (
    <div
      className={`fade-in ${className ?? ""}`}
      style={{ "--delay": `${delayMs}ms` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
