import { loserSide } from "./parse";
import type { Conflict, Provenance, Resolution, SideId } from "./types";
import { ConflictFailure } from "./types";

export type WriteTarget = {
  side: SideId;
  provenance: Provenance;
  body: string;
};

export function planWrites(
  conflict: Conflict,
  resolution: Resolution
): WriteTarget[] {
  if (resolution.kind === "keep") {
    const side = loserSide(resolution.winner);
    const provenance = conflict[side].provenance;
    assertWritable(provenance);
    return [{ side, provenance, body: resolution.loserBody }];
  }
  assertWritable(conflict.left.provenance);
  assertWritable(conflict.right.provenance);
  return [
    {
      side: "left",
      provenance: conflict.left.provenance,
      body: resolution.leftBody,
    },
    {
      side: "right",
      provenance: conflict.right.provenance,
      body: resolution.rightBody,
    },
  ];
}

function assertWritable(provenance: Provenance): void {
  if (provenance.kind === "notion" || provenance.kind === "google") {
    throw new ConflictFailure({
      kind: "unwritable-loser",
      provenanceKind: provenance.kind,
    });
  }
}
