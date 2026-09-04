"use client";

import * as React from "react";

import {
  DRAG_MIME,
  type DragPayload,
  computeMoveTarget,
  isTreeMoveDrag,
  parseDragPayload,
} from "@/lib/knowledge-move";

/**
 * Same-page drag payload. HTML5 `getData` is empty during dragover, so
 * drop-target highlighting reads this instead of DataTransfer values.
 */
let activeMove: DragPayload | null = null;

export function getActiveTreeMove(): DragPayload | null {
  return activeMove;
}

export function useTreeMoveDrag(enabled: boolean, payload: DragPayload) {
  const [dragging, setDragging] = React.useState(false);

  const onDragStart = React.useCallback(
    (event: React.DragEvent) => {
      if (!enabled) return;
      activeMove = payload;
      event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
      event.dataTransfer.setData("text/plain", JSON.stringify(payload));
      event.dataTransfer.effectAllowed = "move";
      setDragging(true);
    },
    [enabled, payload]
  );

  const onDragEnd = React.useCallback(() => {
    activeMove = null;
    setDragging(false);
  }, []);

  return {
    dragging,
    props: {
      draggable: enabled,
      onDragStart,
      onDragEnd,
    },
  };
}

export function useTreeMoveDrop(
  enabled: boolean,
  destPrefix: string,
  onDropMove: (src: DragPayload) => void
) {
  const [active, setActive] = React.useState(false);
  const depth = React.useRef(0);

  const reset = React.useCallback(() => {
    depth.current = 0;
    setActive(false);
  }, []);

  const accepts = React.useCallback(
    (types: readonly string[]) => {
      if (!enabled) return false;
      if (!isTreeMoveDrag(types) && !activeMove) return false;
      if (activeMove) return computeMoveTarget(activeMove, destPrefix) !== null;
      return isTreeMoveDrag(types);
    },
    [destPrefix, enabled]
  );

  const onDragEnter = React.useCallback(
    (event: React.DragEvent) => {
      if (!accepts(Array.from(event.dataTransfer.types))) return;
      event.preventDefault();
      event.stopPropagation();
      depth.current += 1;
      setActive(true);
    },
    [accepts]
  );

  const onDragOver = React.useCallback(
    (event: React.DragEvent) => {
      if (!accepts(Array.from(event.dataTransfer.types))) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
    },
    [accepts]
  );

  const onDragLeave = React.useCallback(
    (event: React.DragEvent) => {
      if (!accepts(Array.from(event.dataTransfer.types))) return;
      event.preventDefault();
      event.stopPropagation();
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setActive(false);
    },
    [accepts]
  );

  const onDrop = React.useCallback(
    (event: React.DragEvent) => {
      const types = Array.from(event.dataTransfer.types);
      if (!enabled || (!isTreeMoveDrag(types) && !activeMove)) return;
      event.preventDefault();
      event.stopPropagation();
      reset();
      const raw =
        event.dataTransfer.getData(DRAG_MIME) ||
        event.dataTransfer.getData("text/plain");
      const src = parseDragPayload(raw) ?? activeMove;
      activeMove = null;
      if (!src) return;
      if (computeMoveTarget(src, destPrefix) === null) return;
      onDropMove(src);
    },
    [destPrefix, enabled, onDropMove, reset]
  );

  return {
    active,
    handlers: {
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
    },
  };
}

export function mergeDragProps(
  ...sources: Array<Record<string, unknown> | undefined | null>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const src of sources) {
    if (!src) continue;
    for (const [key, value] of Object.entries(src)) {
      const prev = out[key];
      if (typeof value === "function" && typeof prev === "function") {
        out[key] = (...args: unknown[]) => {
          (prev as (...a: unknown[]) => void)(...args);
          (value as (...a: unknown[]) => void)(...args);
        };
      } else {
        out[key] = value;
      }
    }
  }
  return out;
}
