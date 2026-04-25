"use client";

import * as React from "react";
import mermaid from "mermaid";
import { useTheme } from "next-themes";

function ensureInit(theme: string | undefined) {
  // Re-initialize when the theme changes so diagrams match light/dark.
  // useMaxWidth: false on each diagram type makes mermaid render at its
  // natural width — so long labels keep their full text. The wrapper
  // div below provides horizontal scrolling when the natural width
  // exceeds the article column.
  mermaid.initialize({
    startOnLoad: false,
    theme: theme === "dark" ? "dark" : "default",
    securityLevel: "loose",
    fontFamily: "inherit",
    flowchart: { useMaxWidth: false, htmlLabels: true },
    sequence: { useMaxWidth: false },
    class: { useMaxWidth: false },
    state: { useMaxWidth: false },
    er: { useMaxWidth: false },
    gantt: { useMaxWidth: false },
    journey: { useMaxWidth: false },
  });
}

export function MermaidDiagram({ code }: { code: string }) {
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = React.useState<string>("");
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    ensureInit(resolvedTheme);
    const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
    mermaid
      .render(id, code)
      .then(({ svg }) => {
        if (!cancelled) {
          setSvg(svg);
          setErr(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [code, resolvedTheme]);

  if (err) {
    return (
      <pre className="my-4 overflow-auto rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
        <span className="font-semibold">Mermaid render error</span>
        {"\n"}
        {err}
        {"\n\n"}
        {code}
      </pre>
    );
  }

  // Natural-width SVG inside a horizontally-scrollable wrapper. The
  // outer wrapper bounds to the article column; the inner one inherits
  // the SVG's intrinsic width so overflow-x triggers when needed.
  // Removing the previous [&>svg]:max-w-full constraint lets the SVG
  // keep its layout — long labels stay legible instead of being clipped
  // when the diagram is forced to shrink.
  return (
    <div className="my-4 w-full overflow-x-auto rounded-md border bg-muted/20 p-3">
      <div
        className="mx-auto inline-block min-w-full text-center [&>svg]:mx-auto [&>svg]:h-auto"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
