/**
 * Isolated wiki restore. Shipping main omits Wiki.
 * Conflicts stay parked on this branch.
 */
export type AppNavItem = {
  href: "/knowledge" | "/wiki" | "/suggestions" | "/sources" | "/brains";
  label: "Knowledge" | "Wiki" | "Suggestions" | "Sources" | "Brains";
};

export const APP_NAV_ITEMS: AppNavItem[] = [
  { href: "/knowledge", label: "Knowledge" },
  { href: "/wiki", label: "Wiki" },
  { href: "/suggestions", label: "Suggestions" },
  { href: "/sources", label: "Sources" },
  { href: "/brains", label: "Brains" },
];

export const WIKI_SETTINGS_HREF = "/wiki/settings";
