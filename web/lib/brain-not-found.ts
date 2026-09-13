/**
 * Knowledge / wiki / sources gate copy when the selected brain id 404s.
 *
 * A brand-new stack has zero brains. Cookie/query are empty, so the
 * client falls back to `default` and GET /api/brains/default 404s.
 * That is not a stale link — there is nothing to pick.
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
  currentBrainId: string;
}): BrainNotFoundCopy {
  if (isEmptyStackNotFound(opts)) {
    return {
      kind: "empty-stack",
      title: "No brains yet",
      body: "A brain is an isolated knowledge base. Create one to ingest sources and ask the wiki.",
      ctaLabel: "Create a brain",
      href: "/brains?new=1",
      ctaVariant: "default",
    };
  }
  return {
    kind: "stale-link",
    title: "Brain not found",
    body: `No brain registered under ${opts.currentBrainId}. It may have been deleted, or the link may be stale.`,
    ctaLabel: "Pick another brain",
    href: "/brains",
    ctaVariant: "outline",
  };
}
