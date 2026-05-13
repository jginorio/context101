"use client";

import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

/**
 * Client-side brain context.
 *
 * Holds the currently selected brain id, plus the catalog of brains
 * fetched from `/api/brains/list`. The provider:
 *
 *   1. Hydrates initial state from the URL `?brain=` query param, then
 *      from the `ctx_brain` cookie, falling back to "default".
 *   2. Loads the brain catalog on mount and refreshes it after a brain
 *      create/delete (callers fire `refreshBrains()`).
 *   3. `setBrain(id)` writes the cookie *and* replaces the URL with
 *      `?brain=<id>` so shareable links stay scoped to the right brain.
 *
 * Server routes read the same precedence (query → header → cookie →
 * default) via `lib/brains-server.ts`. URL is the source of truth when
 * navigating; cookie is the source of truth across sessions.
 */

export type ClientBrain = {
  brain_id: string;
  display_name: string;
  description?: string | null;
  status: "provisioning" | "ready" | "error" | "deleting";
  created_at: string;
  created_by_email?: string | null;
  error_msg?: string | null;
};

const COOKIE_NAME = "ctx_brain";
const QUERY_PARAM = "brain";
const DEFAULT_BRAIN_ID = "default";

type BrainContextValue = {
  currentBrainId: string;
  /**
   * The registry row for the currently-selected brain, **regardless of
   * status**. Populated from the ready-list when possible (fast path), else
   * via a direct `/api/brains/<id>` fetch. Components that only want to
   * act when the brain is usable should check `currentBrain.status ===
   * "ready"`.
   *
   * `undefined` while we're resolving (initial mount, switching brain).
   * Combined with `currentBrainNotFound` lets the UI distinguish loading
   * from a missing/deleted brain.
   */
  currentBrain: ClientBrain | undefined;
  /** True once we've confirmed the selected id doesn't exist in the registry. */
  currentBrainNotFound: boolean;
  /** Ready brains only — what the header switcher dropdown shows. */
  brains: ClientBrain[];
  loading: boolean;
  error: string | null;
  setBrain: (id: string) => void;
  refreshBrains: () => Promise<void>;
};

const BrainContext = React.createContext<BrainContextValue | undefined>(
  undefined
);

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split("; ")) {
    if (part.startsWith(prefix)) return decodeURIComponent(part.slice(prefix.length));
  }
  return null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  // 1 year, path-/. SameSite=Lax so it travels on same-origin nav links;
  // not HttpOnly so SSR can read it via `cookies()` and the client can
  // mirror it without a roundtrip.
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${
    60 * 60 * 24 * 365
  }; samesite=lax`;
}

export function BrainProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Hydration: query → cookie → default. Server reads the same precedence.
  // We compute this lazily on the first render so SSR + client agree.
  const [currentBrainId, setCurrentBrainId] = React.useState<string>(() => {
    const fromQuery = searchParams.get(QUERY_PARAM);
    if (fromQuery) return fromQuery;
    const fromCookie = readCookie(COOKIE_NAME);
    if (fromCookie) return fromCookie;
    return DEFAULT_BRAIN_ID;
  });

  const [brains, setBrains] = React.useState<ClientBrain[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refreshBrains = React.useCallback(async () => {
    try {
      setLoading(true);
      // `status=all` so the switcher can render in-flight provisioning
      // / errored rows in their own sections AND so a deep-linked
      // `?brain=<provisioning-id>` resolves from the fast path. The
      // switcher does its own client-side filter to show only ready
      // brains in the main pickable list.
      const res = await fetch("/api/brains/list?status=all", { cache: "no-store" });
      if (!res.ok) {
        setError(`brains/list failed: ${res.status}`);
        setBrains([]);
        return;
      }
      const data = (await res.json()) as { items?: ClientBrain[] };
      setBrains(data.items ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBrains([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refreshBrains();
  }, [refreshBrains]);

  // Keep state in sync if the URL's `?brain=` changes (back/forward nav,
  // pasted links). Only update when the query param differs from state.
  React.useEffect(() => {
    const fromQuery = searchParams.get(QUERY_PARAM);
    if (fromQuery && fromQuery !== currentBrainId) {
      setCurrentBrainId(fromQuery);
      writeCookie(COOKIE_NAME, fromQuery);
    }
  }, [searchParams, currentBrainId]);

  const setBrain = React.useCallback(
    (id: string) => {
      setCurrentBrainId(id);
      writeCookie(COOKIE_NAME, id);
      // Update the URL so links remain scoped to the selected brain.
      const params = new URLSearchParams(searchParams.toString());
      if (id === DEFAULT_BRAIN_ID) {
        params.delete(QUERY_PARAM);
      } else {
        params.set(QUERY_PARAM, id);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  // `currentBrain` resolution has two paths:
  //
  //   Fast path  — the selected brain is in `brains` (the ready-list).
  //                Common case, no extra fetch.
  //   Slow path  — the selected id is *not* in the list. Could be a
  //                still-provisioning brain (shared link to a freshly-
  //                created brain), an errored one, a deleting one, or
  //                a non-existent one. Fetch `/api/brains/<id>` so we
  //                can render the right state instead of letting every
  //                downstream call 409 ("brain not ready") or 404.
  //
  // The slow-path lookup is keyed on (currentBrainId, brains.length) so
  // it re-fires whenever the user switches brain OR the ready-list
  // refreshes (a provisioning brain becoming ready should populate
  // currentBrain from the fast path on the next refresh).
  const [fetchedBrain, setFetchedBrain] = React.useState<ClientBrain | null | undefined>(
    undefined
  );

  // Fast-path match (memoized) — pulled out so the slow-path effect can
  // depend on it without resolving the whole brains[] identity.
  const fastMatch = React.useMemo(
    () => brains.find((b) => b.brain_id === currentBrainId),
    [brains, currentBrainId]
  );

  React.useEffect(() => {
    // Don't fire while the initial ready-list is still loading — the
    // fast path may resolve in a few ms and save a roundtrip.
    if (loading) return;

    // If the ready-list matches, no by-id fetch needed.
    if (fastMatch) {
      setFetchedBrain(undefined);
      return;
    }

    let cancelled = false;
    setFetchedBrain(undefined); // mark as "resolving" while we fetch
    (async () => {
      try {
        const res = await fetch(
          `/api/brains/${encodeURIComponent(currentBrainId)}`,
          { cache: "no-store" }
        );
        if (cancelled) return;
        if (res.status === 404) {
          setFetchedBrain(null);
          return;
        }
        if (!res.ok) {
          // Treat other failures as "we don't know" — better than
          // claiming the brain is gone. Surface via the existing `error`
          // state separately.
          setFetchedBrain(null);
          return;
        }
        const data = (await res.json()) as { brain?: ClientBrain };
        setFetchedBrain(data.brain ?? null);
      } catch {
        if (!cancelled) setFetchedBrain(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentBrainId, fastMatch, loading]);

  const currentBrain: ClientBrain | undefined = fastMatch ?? fetchedBrain ?? undefined;
  const currentBrainNotFound = !fastMatch && fetchedBrain === null;

  const value: BrainContextValue = React.useMemo(
    () => ({
      currentBrainId,
      currentBrain,
      currentBrainNotFound,
      brains,
      loading,
      error,
      setBrain,
      refreshBrains,
    }),
    [
      currentBrainId,
      currentBrain,
      currentBrainNotFound,
      brains,
      loading,
      error,
      setBrain,
      refreshBrains,
    ]
  );

  return <BrainContext.Provider value={value}>{children}</BrainContext.Provider>;
}

export function useBrain(): BrainContextValue {
  const v = React.useContext(BrainContext);
  if (!v) {
    throw new Error("useBrain() must be used inside <BrainProvider>");
  }
  return v;
}

/**
 * Helper for client-side `fetch()` calls — appends `?brain=<id>` to a URL.
 * SSR routes also accept the `x-brain-id` header or `ctx_brain` cookie,
 * but the query param is the most explicit and least surprising.
 */
export function withBrain(url: string, brainId: string): string {
  const u = new URL(url, "http://placeholder");
  u.searchParams.set(QUERY_PARAM, brainId);
  // Re-serialize as a relative URL since the original was relative.
  return url.startsWith("/") ? `${u.pathname}${u.search}${u.hash}` : u.toString();
}
