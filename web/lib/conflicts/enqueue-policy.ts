import type { ContentHash, SkipReason } from "./types";

export type EnqueueDecision =
  | { kind: "insert" }
  | { kind: "bump"; id: string }
  | { kind: "skip"; reason: SkipReason };

function sameHashes(
  a: { left: ContentHash; right: ContentHash },
  b: { left: ContentHash; right: ContentHash }
): boolean {
  return a.left === b.left && a.right === b.right;
}

/** Detect never writes pins. Same hashes after reject stay skipped. */
export function decideEnqueue(input: {
  incoming: { left: ContentHash; right: ContentHash };
  open: { id: string; hashes: { left: ContentHash; right: ContentHash } } | null;
  pin: { hashes: { left: ContentHash; right: ContentHash } } | null;
}): EnqueueDecision {
  if (input.pin && sameHashes(input.pin.hashes, input.incoming)) {
    return { kind: "skip", reason: "pinned-unchanged" };
  }
  if (input.open) {
    return { kind: "bump", id: input.open.id };
  }
  return { kind: "insert" };
}

export function decideHashWatch(input: {
  storedHash: ContentHash | null;
  incomingHash: ContentHash;
}): "skip" | "continue" {
  if (input.storedHash && input.storedHash === input.incomingHash) {
    return "skip";
  }
  return "continue";
}
