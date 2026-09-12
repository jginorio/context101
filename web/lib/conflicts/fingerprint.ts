import { createHash } from "node:crypto";

import { invertGithubS3Body } from "../github-doc-format";

import type {
  BrainId,
  ClaimTopic,
  ContentHash,
  Fingerprint,
  OrgId,
  Provenance,
} from "./types";

export function provenanceId(p: Provenance): string {
  switch (p.kind) {
    case "github":
      return `github:${p.repo}:${p.repoPath}`;
    case "notion":
      return `notion:${p.pageId}`;
    case "google":
      return `${p.sourceType}:${p.key}`;
    case "manual":
      return `s3:${p.key}`;
  }
}

export function fingerprintOf(
  orgId: OrgId,
  brainId: BrainId,
  topic: ClaimTopic,
  idA: string,
  idB: string
): Fingerprint {
  const lo = idA < idB ? idA : idB;
  const hi = idA < idB ? idB : idA;
  return createHash("sha256")
    .update(`${orgId}\n${brainId}\n${topic}\n${lo}\n${hi}`, "utf8")
    .digest("hex");
}

export function canonicalHash(body: string): ContentHash {
  return createHash("sha256")
    .update(invertGithubS3Body(body), "utf8")
    .digest("hex");
}
