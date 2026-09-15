/**
 * Operator-facing wiki chrome (nav, /wiki, Ask the brain, wiki settings).
 *
 * Wiki generation stays in the stack — APIs, wiki-generator-ts, CDK image —
 * but the admin UI hides it while generation is paused / undecided.
 *
 * Wiki model/API-key settings live at `WIKI_SETTINGS_HREF` (`/wiki/settings`),
 * not under Settings → Advanced. Flipping this flag restores the Wiki nav
 * and those colocated controls together.
 *
 * Re-enable later: set `WIKI_UI_ENABLED` to `true`. All gated surfaces
 * read this constant; do not hunt for individual call sites.
 */
export const WIKI_UI_ENABLED = false;

/** Model + API-key controls for wiki generation. Gated with the wiki surface. */
export const WIKI_SETTINGS_HREF = "/wiki/settings";

export type AppNavItem = {
  href: string;
  label: string;
  /** When true, the item is omitted unless `WIKI_UI_ENABLED` is on. */
  wiki?: boolean;
};

export const APP_NAV_ITEMS: AppNavItem[] = [
  { href: "/knowledge", label: "Knowledge" },
  { href: "/wiki", label: "Wiki", wiki: true },
  { href: "/suggestions", label: "Suggestions" },
  { href: "/conflicts", label: "Conflicts" },
  { href: "/sources", label: "Sources" },
  { href: "/brains", label: "Brains" },
];

export function visibleAppNavItems(
  wikiUiEnabled: boolean = WIKI_UI_ENABLED
): AppNavItem[] {
  return APP_NAV_ITEMS.filter((item) => !item.wiki || wikiUiEnabled);
}
