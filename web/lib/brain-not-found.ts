/**
 * Knowledge / wiki / sources gate + header copy when no brain is usable.
 *
 * A brand-new stack has zero brains. Cookie/query/header are empty, so
 * there is no selected id (there is no implicit `default` brain). That
 * is not a stale link — there is nothing to pick. A leftover
 * `ctx_brain=default` cookie on an empty catalog is the same case: do
 * not present that id as the active brain.
 */

export type BrainNotFoundKind = "empty-stack" | "stale-link";

export type BrainNotFoundCopy = {
  kind: BrainNotFoundKind;
  title: string;
  /** Plain body for tests and aria. The gate may wrap the id in <code>. */
  body: string;
  ctaLabel: string;
  href: string;
  ctaVariant: "default" | "outline";
};

export function isEmptyStackNotFound(opts: {
  loading: boolean;
  error: string | null;
  brainsCount: number;
}): boolean {
  return !opts.loading && opts.error === null && opts.brainsCount === 0;
}

export function brainNotFoundCopy(opts: {
  loading: boolean;
  error: string | null;
  brainsCount: number;
  currentBrainId: string | null;
}): BrainNotFoundCopy {
  if (isEmptyStackNotFound(opts)) {
    return {
      kind: "empty-stack",
      title: "No brains yet",
      body: "A brain is an isolated knowledge base. Create one to ingest sources.",
      ctaLabel: "Create a brain",
      href: "/brains?new=1",
      ctaVariant: "default",
    };
  }
  return {
    kind: "stale-link",
    title: "Brain not found",
    body: `No brain registered under ${opts.currentBrainId ?? "—"}. It may have been deleted, or the link may be stale.`,
    ctaLabel: "Pick another brain",
    href: "/brains",
    ctaVariant: "outline",
  };
}

export type BrainSwitcherCopyKind =
  | "loading"
  | "empty-stack"
  | "active"
  | "stale-link";

export type BrainSwitcherCopy = {
  kind: BrainSwitcherCopyKind;
  hint: string;
  label: string;
  ariaLabel: string;
};

/**
 * Header / sidebar label for the active brain. Empty catalog never
 * surfaces `default` (or any other leftover id). Loading never flashes
 * a raw id — wait until the catalog resolves.
 */
export function brainSwitcherCopy(opts: {
  loading: boolean;
  error: string | null;
  brainsCount: number;
  currentBrainId: string | null;
  currentBrain?: { display_name: string; status: string } | undefined;
}): BrainSwitcherCopy {
  if (isEmptyStackNotFound(opts)) {
    return {
      kind: "empty-stack",
      hint: "No brains yet",
      label: "Create a brain",
      ariaLabel: "No brains yet. Create a brain",
    };
  }

  if (opts.loading && !opts.currentBrain) {
    return {
      kind: "loading",
      hint: "Loading brains…",
      label: "—",
      ariaLabel: "Loading brains",
    };
  }

  const status = opts.currentBrain?.status;
  const hint =
    status === "provisioning"
      ? "Provisioning…"
      : status === "error"
        ? "Needs attention"
        : status === "deleting"
          ? "Deleting…"
          : "Active brain";
  const label = opts.currentBrain?.display_name ?? opts.currentBrainId ?? "—";
  if (opts.currentBrain) {
    return {
      kind: "active",
      hint,
      label,
      ariaLabel: `Active brain: ${label}. Switch brain`,
    };
  }
  return {
    kind: "stale-link",
    hint,
    label,
    ariaLabel: `Brain not found: ${label}. Switch brain`,
  };
}
