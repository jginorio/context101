/**
 * In-app Knowledge tree moves (drag a library file onto a folder).
 * Distinct from OS file drops, which upload new markdown via
 * `application/x-context101` vs the browser `Files` type.
 */

export const DRAG_MIME = "application/x-context101";

export type DragPayload = { key: string; isFolder: boolean };

export function isTreeMoveDrag(types: readonly string[]): boolean {
  return types.includes(DRAG_MIME);
}

export function itemName(key: string, isFolder: boolean): string {
  const trimmed = isFolder ? key.replace(/\/$/, "") : key;
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

export function currentParentOf(key: string, isFolder: boolean): string {
  const name = itemName(key, isFolder);
  if (!name) return "";
  if (isFolder) return key.slice(0, -(name.length + 1));
  return key.slice(0, key.length - name.length);
}

export function normalizeDestPrefix(prefix: string): string {
  if (!prefix) return "";
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

export function parseDragPayload(raw: string): DragPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "key" in parsed &&
      "isFolder" in parsed &&
      typeof (parsed as DragPayload).key === "string" &&
      typeof (parsed as DragPayload).isFolder === "boolean" &&
      (parsed as DragPayload).key.length > 0
    ) {
      return parsed as DragPayload;
    }
  } catch {
    // text/plain fallback is the S3 key
    if (!raw.includes("\n") && !raw.includes("..") && !raw.startsWith("/")) {
      return { key: raw, isFolder: raw.endsWith("/") };
    }
  }
  return null;
}

/**
 * Destination key when dropping `src` into folder `destPrefix`.
 * Returns null for no-ops (same parent) or illegal moves (folder into
 * itself / a descendant).
 */
export function computeMoveTarget(
  src: DragPayload,
  destPrefix: string
): string | null {
  const dest = normalizeDestPrefix(destPrefix);
  const name = itemName(src.key, src.isFolder);
  if (!name) return null;

  const currentParent = currentParentOf(src.key, src.isFolder);
  if (currentParent === dest) return null;

  if (src.isFolder && dest.startsWith(src.key)) return null;

  return src.isFolder ? `${dest}${name}/` : `${dest}${name}`;
}

/**
 * Destination key when renaming `src` in place. Returns null for no-ops
 * and for names that can't be a single path segment.
 */
export function computeRenameTarget(
  src: DragPayload,
  newName: string
): string | null {
  const name = newName.trim().replace(/^\/+|\/+$/g, "");
  if (!name || name.includes("/") || name.includes("..")) return null;
  if (name === itemName(src.key, src.isFolder)) return null;

  const parent = currentParentOf(src.key, src.isFolder);
  return src.isFolder ? `${parent}${name}/` : `${parent}${name}`;
}

export async function moveItem(from: string, to: string): Promise<void> {
  const r = await fetch("/api/files/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error ?? `move failed: ${r.status}`);
}
