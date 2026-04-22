"use client";

import * as React from "react";
import mermaid from "mermaid";
import { useTheme } from "next-themes";

function ensureInit(theme: string | undefined) {
  // Re-initialize when the theme changes so diagrams match light/dark.
  mermaid.initialize({
    startOnLoad: false,
    theme: theme === "dark" ? "dark" : "default",
    securityLevel: "loose",
    fontFamily: "inherit",
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

  return (
    <div
      className="my-4 flex justify-center overflow-x-auto [&>svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
