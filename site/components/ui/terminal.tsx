"use client";

import * as React from "react";

// Lightweight, dependency-free take on the Magic UI terminal. The Terminal
// auto-sequences its children: each TypingAnimation/AnimatedSpan starts when
// the previous one finishes, and the whole thing kicks off when it scrolls
// into view.

type InjectedProps = {
  _active?: boolean;
  _onComplete?: () => void;
};

export function Terminal({
  children,
  className = "",
  startOnView = true,
}: {
  children: React.ReactNode;
  className?: string;
  startOnView?: boolean;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [inView, setInView] = React.useState(!startOnView);
  const [active, setActive] = React.useState(0);

  React.useEffect(() => {
    if (!startOnView || inView) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [startOnView, inView]);

  const items = React.Children.toArray(children);

  return (
    <div
      ref={ref}
      className={`surface-card surface-card--wide overflow-hidden ${className}`}
    >
      <div className="flex items-center gap-1.5 border-b border-[color-mix(in_srgb,var(--accent)_14%,var(--line))] px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className="ml-2 font-mono text-xs text-muted-foreground">
          deploy — context101
        </span>
      </div>
      <div className="min-h-[232px] space-y-1 px-4 py-3.5 font-mono text-[13px] leading-6 text-foreground/90">
        {items.map((child, i) =>
          React.isValidElement(child)
            ? React.cloneElement(child as React.ReactElement<InjectedProps>, {
                _active: inView && i <= active,
                _onComplete: () => setActive((a) => Math.max(a, i + 1)),
              })
            : child
        )}
      </div>
    </div>
  );
}

export function TypingAnimation({
  children,
  className = "",
  duration = 28,
  _active = false,
  _onComplete,
}: {
  children: string;
  className?: string;
  duration?: number;
} & InjectedProps) {
  const text = typeof children === "string" ? children : "";
  const [out, setOut] = React.useState("");
  const done = React.useRef(false);

  React.useEffect(() => {
    if (!_active) return;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setOut(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(id);
        if (!done.current) {
          done.current = true;
          window.setTimeout(() => _onComplete?.(), 220);
        }
      }
    }, duration);
    return () => clearInterval(id);
    // _onComplete intentionally excluded so re-renders don't restart typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_active, text, duration]);

  if (!_active) return null;
  const typing = out.length < text.length;
  return (
    <div className={`block break-all whitespace-pre-wrap ${className}`}>
      {out}
      {typing ? <span className="typing-cursor">▍</span> : null}
    </div>
  );
}

export function AnimatedSpan({
  children,
  className = "",
  _active = false,
  _onComplete,
}: {
  children: React.ReactNode;
  className?: string;
} & InjectedProps) {
  const [show, setShow] = React.useState(false);
  const done = React.useRef(false);

  React.useEffect(() => {
    if (!_active) return;
    const t1 = window.setTimeout(() => setShow(true), 20);
    const t2 = window.setTimeout(() => {
      if (!done.current) {
        done.current = true;
        _onComplete?.();
      }
    }, 320);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_active]);

  if (!_active) return null;
  return (
    <div
      className={`block transition-all duration-300 ${
        show ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
      } ${className}`}
    >
      {children}
    </div>
  );
}
