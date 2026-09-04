"use client";

import * as React from "react";

import {
  filesFromDataTransfer,
  isExternalFileDrag,
} from "@/lib/knowledge-upload";

/**
 * Attach to a drop target that should accept OS file drags (multiple
 * `.md` files, or a folder of them). In-app tree moves use a different
 * MIME type and are ignored here.
 */
export function useExternalFileDrop(
  enabled: boolean,
  onDropFiles: (files: File[]) => void
) {
  const [active, setActive] = React.useState(false);
  const depth = React.useRef(0);

  const reset = React.useCallback(() => {
    depth.current = 0;
    setActive(false);
  }, []);

  const onDragEnter = React.useCallback(
    (event: React.DragEvent) => {
      if (!enabled || !isExternalFileDrag(Array.from(event.dataTransfer.types))) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      depth.current += 1;
      setActive(true);
    },
    [enabled]
  );

  const onDragOver = React.useCallback(
    (event: React.DragEvent) => {
      if (!enabled || !isExternalFileDrag(Array.from(event.dataTransfer.types))) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
    },
    [enabled]
  );

  const onDragLeave = React.useCallback(
    (event: React.DragEvent) => {
      if (!enabled || !isExternalFileDrag(Array.from(event.dataTransfer.types))) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setActive(false);
    },
    [enabled]
  );

  const onDrop = React.useCallback(
    (event: React.DragEvent) => {
      if (!enabled || !isExternalFileDrag(Array.from(event.dataTransfer.types))) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      reset();
      void filesFromDataTransfer(event.dataTransfer).then(onDropFiles);
    },
    [enabled, onDropFiles, reset]
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
