"use client";

import * as React from "react";

const MOBILE_QUERY = "(max-width: 767px)";
const ACTIVATE_PX = 10;
const CLOSE_PX = 96;
const CLOSE_VELOCITY = 0.55;

function isMobileViewport() {
  return (
    typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches
  );
}

function isTextField(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest("input, textarea, select, [contenteditable='true']");
}

/**
 * Downward swipe-to-dismiss for mobile bottom drawers.
 * Starts from the grabber, or from the sheet body when it is scrolled to the top.
 */
export function useDrawerSwipe(onDismiss: () => void) {
  const ref = React.useRef<HTMLDivElement>(null);
  const onDismissRef = React.useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const drag = React.useRef<{
    pointerId: number;
    startY: number;
    lastY: number;
    lastT: number;
    dy: number;
    active: boolean;
    fromHandle: boolean;
  } | null>(null);

  const apply = React.useCallback((dy: number, animate: boolean) => {
    const el = ref.current;
    if (!el) return;
    // Tailwind v4 translate-* uses the `translate` property, not transform.
    el.style.transition = animate
      ? "translate 280ms ease-out, transform 280ms ease-out"
      : "none";
    el.style.translate = dy <= 0 ? "" : `0 ${dy}px`;
    el.style.transform = "";
  }, []);

  const clear = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transition = "";
    el.style.translate = "";
    el.style.transform = "";
  }, []);

  const onPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isMobileViewport()) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (isTextField(event.target)) return;

      const el = ref.current;
      if (!el) return;

      const fromHandle = !!(event.target instanceof Element
        ? event.target.closest("[data-drawer-handle]")
        : null);
      if (!fromHandle && el.scrollTop > 0) return;

      drag.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        lastY: event.clientY,
        lastT: performance.now(),
        dy: 0,
        active: false,
        fromHandle,
      };
    },
    []
  );

  const onPointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const state = drag.current;
      if (!state || state.pointerId !== event.pointerId) return;

      const dy = event.clientY - state.startY;
      if (!state.active) {
        if (Math.abs(dy) < ACTIVATE_PX) return;
        // Upward move is scroll, not dismiss — unless it started on the handle.
        if (dy < 0 && !state.fromHandle) {
          drag.current = null;
          return;
        }
        state.active = true;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* already captured or unsupported */
        }
      }

      const next = Math.max(0, dy);
      state.dy = next;
      state.lastY = event.clientY;
      state.lastT = performance.now();
      apply(next, false);
    },
    [apply]
  );

  const endDrag = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const state = drag.current;
      if (!state || state.pointerId !== event.pointerId) return;
      drag.current = null;

      const el = ref.current;
      if (!el || !state.active) {
        clear();
        return;
      }

      const dt = Math.max(1, performance.now() - state.lastT);
      const velocity = (event.clientY - state.lastY) / dt;
      const height = el.getBoundingClientRect().height || 1;
      const shouldClose =
        state.dy > Math.min(CLOSE_PX, height * 0.22) || velocity > CLOSE_VELOCITY;

      if (!shouldClose) {
        apply(0, true);
        const snap = () => {
          el.removeEventListener("transitionend", snap);
          clear();
        };
        el.addEventListener("transitionend", snap);
        window.setTimeout(snap, 320);
        return;
      }

      el.style.transition = "translate 280ms ease-out, transform 280ms ease-out";
      el.style.translate = "0 100%";
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        el.removeEventListener("transitionend", finish);
        onDismissRef.current();
        window.requestAnimationFrame(clear);
      };
      el.addEventListener("transitionend", finish);
      window.setTimeout(finish, 340);
    },
    [apply, clear]
  );

  return {
    ref,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };
}
