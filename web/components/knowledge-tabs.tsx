"use client";

import * as React from "react";
import { FileText, X } from "lucide-react";

import { cn } from "@/lib/utils";

function basename(key: string): string {
  const trimmed = key.replace(/\/$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/**
 * VS Code / Notion-style tab strip for the document viewer. Purely
 * presentational — open/close/activate state lives in the page so other
 * surfaces (sidebar clicks, "open in new tab", wiki deep-links) can drive it.
 */
export function KnowledgeTabs({
  tabs,
  activeKey,
  onActivate,
  onClose,
}: {
  tabs: string[];
  activeKey: string | null;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
}) {
  if (tabs.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label="Open documents"
      className="flex shrink-0 items-stretch overflow-x-auto border-b bg-muted/20"
    >
      {tabs.map((key) => {
        const active = key === activeKey;
        return (
          <div
            key={key}
            role="tab"
            aria-selected={active}
            title={key}
            onClick={() => onActivate(key)}
            // Middle-click closes, matching browser/editor behavior.
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onClose(key);
              }
            }}
            className={cn(
              "group flex min-w-0 max-w-52 shrink-0 cursor-pointer items-center gap-1.5 border-r px-3 py-1.5 text-xs transition-colors",
              active
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-background/60"
            )}
          >
            <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="truncate">{basename(key)}</span>
            <button
              type="button"
              aria-label={`Close ${basename(key)}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(key);
              }}
              className={cn(
                "-mr-1 ml-0.5 shrink-0 rounded p-0.5 hover:bg-muted",
                active ? "opacity-70" : "opacity-0 group-hover:opacity-70"
              )}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
