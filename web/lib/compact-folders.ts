/**
 * Collapse single-child folder chains in browse-mode source trees.
 *
 * A GitHub sync scoped to `apps/plateapr.com/docs` otherwise forces three
 * extra expands (`apps` → `plateapr.com` → `docs`) before any file appears.
 * When a folder has exactly one child folder and no files, we join the
 * path (`apps/plateapr.com/docs`) and treat the deepest folder as the node.
 */

export type CompactFolderEntry = { key: string; name: string };

export type CompactFolderListing = {
  folders: CompactFolderEntry[];
  files: { key: string; name: string }[];
};

export type CompactListingState =
  | { status: "loading" }
  | { status: "loaded"; data: CompactFolderListing }
  | { status: "error"; message: string };

export function isSingleChildFolder(
  listing: CompactFolderListing
): boolean {
  return listing.folders.length === 1 && listing.files.length === 0;
}

export function nextCompactPrefetchKey(
  listing: CompactFolderListing
): string | null {
  return isSingleChildFolder(listing) ? listing.folders[0].key : null;
}

export function compactFolder(
  folder: CompactFolderEntry,
  listings: Record<string, CompactListingState>
): { key: string; name: string; segments: string[] } {
  const segments = [folder.name];
  let key = folder.key;
  const seen = new Set<string>([key]);

  while (true) {
    const state = listings[key];
    if (state?.status !== "loaded") break;
    if (!isSingleChildFolder(state.data)) break;
    const child = state.data.folders[0];
    if (!child.key || seen.has(child.key)) break;
    seen.add(child.key);
    segments.push(child.name);
    key = child.key;
  }

  return { key, name: segments.join("/"), segments };
}

/**
 * Deepest keys of compacted children under `parentPrefix`. Used to auto-expand
 * a joined path so files show after the parent (e.g. the repo) is opened.
 */
export function compactedChildrenToExpand(
  parentPrefix: string,
  listings: Record<string, CompactListingState>,
  hideNames?: string[]
): string[] {
  const state = listings[parentPrefix];
  if (state?.status !== "loaded") return [];
  const folders = hideNames?.length
    ? state.data.folders.filter((folder) => !hideNames.includes(folder.name))
    : state.data.folders;
  const keys: string[] = [];
  for (const folder of folders) {
    const resolved = compactFolder(folder, listings);
    if (resolved.segments.length > 1) keys.push(resolved.key);
  }
  return keys;
}
