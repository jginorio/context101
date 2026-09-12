export type OrgId = string;
export type BrainId = string;
export type ConflictId = string;
export type Fingerprint = string;
export type S3Key = string;
export type ClaimTopic = string;
export type ContentHash = string;
export type BlobSha = string;
export type Markdown = string;

export type ConflictScope = {
  orgId: OrgId;
  brainId: BrainId;
};

export type Actor = {
  id: string;
  email: string | null;
};

export type SideId = "left" | "right";

export type Provenance =
  | {
      kind: "github";
      key: S3Key;
      connectorId: string;
      repo: string;
      repoPath: string;
      branch: string;
      blobSha: BlobSha;
      language: "markdown";
    }
  | {
      kind: "notion";
      key: S3Key;
      connectorId: string;
      pageId: string;
    }
  | {
      kind: "google";
      key: S3Key;
      connectorId: string;
      sourceType: "docs" | "sheets" | "slides";
    }
  | {
      kind: "manual";
      key: S3Key;
    };

export type Claim = {
  topic: ClaimTopic;
  text: string;
  excerpt: string;
};

export type Side = {
  provenance: Provenance;
  claim: Claim;
  canonicalHash: ContentHash;
};

export type ConflictPair = {
  topic: ClaimTopic;
  title: string;
  rationale: string;
  left: Side;
  right: Side;
  fingerprint: Fingerprint;
  proposedLoserBody: { left: Markdown; right: Markdown };
};

type ConflictMeta = {
  id: ConflictId;
  orgId: OrgId;
  brainId: BrainId;
  occurrenceCount: number;
  lastDetectedVia: "ingest" | "query";
  createdAt: Date;
  updatedAt: Date;
};

export type PendingConflict = ConflictPair &
  ConflictMeta & {
    status: "pending";
    lastError: string | null;
  };

export type ApplyingConflict = ConflictPair &
  ConflictMeta & {
    status: "applying";
    lastError: string | null;
  };

export type Resolution =
  | { kind: "keep"; winner: SideId; loserBody: Markdown }
  | { kind: "merge"; leftBody: Markdown; rightBody: Markdown };

export type WriteReceipt =
  | {
      kind: "github";
      key: S3Key;
      repo: string;
      repoPath: string;
      beforeSha: BlobSha;
      afterSha: BlobSha;
    }
  | { kind: "s3"; key: S3Key };

export type ApplyRecord = {
  wrote: WriteReceipt[];
  pinnedAt: Date;
};

export type AcceptedConflict = ConflictPair &
  ConflictMeta & {
    status: "accepted";
    resolution: Resolution;
    apply: ApplyRecord;
    reviewedBy: string;
    reviewedAt: Date;
  };

export type RejectedConflict = ConflictPair &
  ConflictMeta & {
    status: "rejected";
    reviewedBy: string;
    reviewedAt: Date;
  };

export type Conflict =
  | PendingConflict
  | ApplyingConflict
  | AcceptedConflict
  | RejectedConflict;

export type Pin = {
  fingerprint: Fingerprint;
  outcome: "accepted" | "rejected";
  leftKey: S3Key;
  rightKey: S3Key;
  topic: ClaimTopic;
  hashes: { left: ContentHash; right: ContentHash };
  githubBlobShas: Partial<Record<SideId, BlobSha>>;
  conflictId: ConflictId;
  pinnedAt: Date;
};

export type EvidenceReport =
  | { via: "ingest"; bucket: string; keys: S3Key[] }
  | {
      via: "query";
      query: string;
      hits: readonly { key: S3Key; text: string }[];
    };

export type SkipReason =
  | "too-few-docs"
  | "no-contradiction"
  | "pinned-unchanged"
  | "pending-unchanged"
  | "budget"
  | "closed-unchanged";

export type EnqueueResult =
  | { kind: "inserted"; id: ConflictId }
  | { kind: "bumped"; id: ConflictId; occurrenceCount: number }
  | { kind: "skipped"; reason: SkipReason };

export type ApplyResult = {
  conflict: AcceptedConflict;
  wrote: WriteReceipt[];
};

export type ConflictFail =
  | { kind: "not-found" }
  | { kind: "not-pending" }
  | { kind: "unwritable-loser"; provenanceKind: Provenance["kind"] }
  | { kind: "github-sha-mismatch"; key: S3Key }
  | { kind: "github-forbidden"; key: S3Key };

export class ConflictFailure extends Error {
  readonly fail: ConflictFail;
  constructor(fail: ConflictFail) {
    super(fail.kind);
    this.name = "ConflictFailure";
    this.fail = fail;
  }
}

export type ClientConflict = {
  id: string;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
  topic: string;
  title: string;
  rationale?: string;
  left: ClientSide;
  right: ClientSide;
  proposed_loser_body: { left: string; right: string };
  occurrence_count: number;
  last_error?: string;
  last_detected_via: "ingest" | "query";
  reviewed_at?: string;
  reviewer_email?: string;
};

export type ClientSide = {
  key: string;
  kind: Provenance["kind"];
  claim: string;
  excerpt: string;
  label: string;
  unwritable: boolean;
};

export type ListStatus = "pending" | "accepted" | "rejected" | "all";
