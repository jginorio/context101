/**
 * Shipping admin chrome. Product focus is sources + retrieve.
 *
 * Wiki and Conflicts are parked — not listed here, not half-hidden
 * behind flags. Isolated restore branches re-add those items.
 */
export type AppNavItem = {
  href: "/knowledge" | "/suggestions" | "/sources" | "/brains";
  label: "Knowledge" | "Suggestions" | "Sources" | "Brains";
};

export const APP_NAV_ITEMS: AppNavItem[] = [
  { href: "/knowledge", label: "Knowledge" },
  { href: "/suggestions", label: "Suggestions" },
  { href: "/sources", label: "Sources" },
  { href: "/brains", label: "Brains" },
];
