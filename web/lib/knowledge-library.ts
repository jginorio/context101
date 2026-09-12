/**
 * Uploaded-files library (the virtual "Uploaded Files" root). Connector
 * `sources/` and generated `wiki/` live in the same bucket but are not
 * library entries.
 */

export const HIDDEN_ROOT_FOLDERS = ["sources", "wiki"] as const;

export type LibraryListing = {
  folders: { name: string }[];
  files: unknown[];
};

/** True when the brain has at least one uploaded file or user folder. */
export function hasVisibleLibraryEntries(listing: LibraryListing): boolean {
  const folders = listing.folders.filter(
    (folder) =>
      !HIDDEN_ROOT_FOLDERS.includes(
        folder.name as (typeof HIDDEN_ROOT_FOLDERS)[number]
      )
  );
  return folders.length > 0 || listing.files.length > 0;
}
