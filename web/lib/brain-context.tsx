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
  currentBrain: ClientBrain | undefined;
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
      const res = await fetch("/api/brains/list", { cache: "no-store" });
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

  const currentBrain = React.useMemo(
    () => brains.find((b) => b.brain_id === currentBrainId),
    [brains, currentBrainId]
  );

  const value: BrainContextValue = React.useMemo(
    () => ({
      currentBrainId,
      currentBrain,
      brains,
      loading,
      error,
      setBrain,
      refreshBrains,
    }),
    [currentBrainId, currentBrain, brains, loading, error, setBrain, refreshBrains]
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
