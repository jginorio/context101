"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A lightweight searchable combobox: a text input with a filtered suggestion
 * dropdown. The typed text IS the value, so arbitrary/custom entries are
 * allowed (e.g. a model id not in the fetched list) while still offering
 * autocomplete from `items`.
 *
 * The dropdown renders in a portal with fixed positioning so it's never
 * clipped by an ancestor's `overflow` (e.g. a Card).
 */
export function Combobox({
  value,
  onValueChange,
  items,
  placeholder,
  disabled,
  emptyText = "No matches",
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  items: string[];
  placeholder?: string;
  disabled?: boolean;
  emptyText?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);
  const [rect, setRect] = React.useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const popupRef = React.useRef<HTMLDivElement>(null);

  const query = value.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    const list = query
      ? items.filter((i) => i.toLowerCase().includes(query))
      : items;
    return list.slice(0, 50);
  }, [items, query]);

  React.useEffect(() => {
    setHighlight(0);
  }, [filtered.length]);

  const updateRect = React.useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom + 4, left: r.left, width: r.width });
  }, []);

  // Track the anchor position while open (scroll/resize), and close on
  // outside clicks (accounting for the portaled popup).
  React.useEffect(() => {
    if (!open) return;
    updateRect();
    const onReflow = () => updateRect();
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (
        !anchorRef.current?.contains(t) &&
        !popupRef.current?.contains(t)
      ) {
        setOpen(false);
      }
    }
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, updateRect]);

  function select(item: string) {
    onValueChange(item);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (open && filtered[highlight]) {
        e.preventDefault();
        select(filtered[highlight]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={anchorRef} className={cn("relative", className)}>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          onValueChange(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => items.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        className="h-9 w-full rounded-lg border bg-background px-3 pr-8 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      />
      <ChevronsUpDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

      {open && items.length > 0 && rect && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popupRef}
              style={{
                position: "fixed",
                top: rect.top,
                left: rect.left,
                width: rect.width,
              }}
              className="z-50 max-h-60 overflow-auto rounded-md border bg-popover p-1 shadow-md"
            >
              {filtered.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  {emptyText}
                </div>
              ) : (
                filtered.map((item, i) => (
                  <button
                    type="button"
                    key={item}
                    // onMouseDown (not onClick) so it fires before input blur.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      select(item);
                    }}
                    onMouseEnter={() => setHighlight(i)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                      i === highlight ? "bg-accent" : "hover:bg-accent/60"
                    )}
                  >
                    <span className="truncate font-mono text-xs">{item}</span>
                    {item === value ? (
                      <Check className="h-3.5 w-3.5 shrink-0" />
                    ) : null}
                  </button>
                ))
              )}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
