/**
 * Helpers for remapping open-document tab keys after a library
 * rename or delete. Folder keys are stored with a trailing slash
 * (e.g. "analytics/"); file keys are not.
 */

export function remapKeyAfterRename(
  key: string,
  from: string,
  to: string,
  isFolder: boolean
): string {
  if (isFolder) {
    return key.startsWith(from) ? `${to}${key.slice(from.length)}` : key;
  }
  return key === from ? to : key;
}

export function applyRenameToKeys(
  keys: string[],
  from: string,
  to: string,
  isFolder: boolean
): string[] {
  return keys.map((key) => remapKeyAfterRename(key, from, to, isFolder));
}

export function isRemovedByDelete(
  key: string,
  deletedKey: string,
  isFolder: boolean
): boolean {
  return isFolder ? key.startsWith(deletedKey) : key === deletedKey;
}

export function applyDeleteToKeys(
  keys: string[],
  deletedKey: string,
  isFolder: boolean
): string[] {
  return keys.filter((key) => !isRemovedByDelete(key, deletedKey, isFolder));
}
