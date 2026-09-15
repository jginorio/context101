/**
 * Isolated conflicts restore. Shipping main omits Conflicts.
 * Wiki stays parked on this branch.
 */
export type AppNavItem = {
  href: "/knowledge" | "/suggestions" | "/conflicts" | "/sources" | "/brains";
  label: "Knowledge" | "Suggestions" | "Conflicts" | "Sources" | "Brains";
};

export const APP_NAV_ITEMS: AppNavItem[] = [
  { href: "/knowledge", label: "Knowledge" },
  { href: "/suggestions", label: "Suggestions" },
  { href: "/conflicts", label: "Conflicts" },
  { href: "/sources", label: "Sources" },
  { href: "/brains", label: "Brains" },
];
