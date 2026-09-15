import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

import { invertGithubS3Body, renderMarkdown } from "@/lib/github-doc-format";
import { pgGetConnector, sm } from "@/utils/connectors";
import {
  getGithubAppConfig,
  getRepoFile,
  mintInstallationToken,
  putRepoFile,
} from "@/utils/github-app";
import { s3 } from "@/utils/s3";

import { canonicalHash } from "./fingerprint";
import { loserSide } from "./parse";
import { type WriteTarget } from "./plan";
import type {
  Conflict,
  ConflictScope,
  Pin,
  Provenance,
  Resolution,
  WriteReceipt,
} from "./types";
import { ConflictFailure } from "./types";

export { planWrites, type WriteTarget } from "./plan";

type Solutioner = {
  kind: Provenance["kind"];
  canHandle(p: Provenance): boolean;
  apply(
    scope: ConflictScope,
    bucket: string,
    target: WriteTarget
  ): Promise<WriteReceipt>;
};

async function githubToken(
  scope: ConflictScope,
  connectorId: string
): Promise<string> {
  const row = await pgGetConnector(scope.orgId, scope.brainId, connectorId);
  if (!row) throw new Error(`github connector ${connectorId} not found`);
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  if (meta.auth === "github-app") {
    const cfg = await getGithubAppConfig();
    if (!cfg) throw new Error("GitHub App is not configured");
    const installationId =
      (typeof meta.github_installation_id === "string"
        ? meta.github_installation_id
        : null) ?? cfg.installation_id;
    if (!installationId) throw new Error("no github app installation recorded");
    return mintInstallationToken(cfg, installationId);
  }
  if (!row.tokenSecretArn) throw new Error("token_secret_arn missing");
  const secret = await sm.send(
    new GetSecretValueCommand({ SecretId: row.tokenSecretArn })
  );
  const parsed = JSON.parse(secret.SecretString ?? "{}") as {
    github_pat?: string;
  };
  if (!parsed.github_pat) throw new Error("github_pat missing from secret");
  return parsed.github_pat;
}

function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`bad repo ${repo}`);
  return { owner, name };
}

const githubSolutioner: Solutioner = {
  kind: "github",
  canHandle: (p) => p.kind === "github",
  apply: async (scope, bucket, target) => {
    if (target.provenance.kind !== "github") {
      throw new Error("github solutioner given non-github target");
    }
    const provenance = target.provenance;
    const inverted = invertGithubS3Body(target.body);
    const { owner, name } = splitRepo(provenance.repo);
    const token = await githubToken(scope, provenance.connectorId);
    const already = await getRepoFile(token, {
      owner,
      repo: name,
      path: provenance.repoPath,
      ref: provenance.branch,
    });
    let afterSha = already?.sha ?? provenance.blobSha;
    if (!already || already.content !== inverted) {
      try {
        const put = await putRepoFile(token, {
          owner,
          repo: name,
          path: provenance.repoPath,
          message: `context101: resolve conflict on ${provenance.repoPath}`,
          content: inverted,
          sha: provenance.blobSha,
          branch: provenance.branch,
        });
        afterSha = put.sha;
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 403) {
          throw new ConflictFailure({
            kind: "github-forbidden",
            key: provenance.key,
          });
        }
        const retry = await getRepoFile(token, {
          owner,
          repo: name,
          path: provenance.repoPath,
          ref: provenance.branch,
        }).catch(() => null);
        if (retry && retry.content === inverted) {
          afterSha = retry.sha;
        } else if (status === 409 || status === 422) {
          throw new ConflictFailure({
            kind: "github-sha-mismatch",
            key: provenance.key,
          });
        } else {
          throw err;
        }
      }
    }
    const now = new Date().toISOString();
    const htmlUrl = `https://github.com/${provenance.repo}/blob/${provenance.branch}/${provenance.repoPath}`;
    const rendered = renderMarkdown(inverted, {
      path: provenance.repoPath,
      repoFullName: provenance.repo,
      htmlUrl,
      now,
    });
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: provenance.key,
        Body: rendered,
        ContentType: "text/markdown; charset=utf-8",
      })
    );
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `${provenance.key}.metadata.json`,
        Body: JSON.stringify(
          {
            metadataAttributes: {
              source: "github",
              connector_id: provenance.connectorId,
              repo: provenance.repo,
              path: provenance.repoPath,
              language: "markdown",
              commit_sha: afterSha,
              branch: provenance.branch,
              last_synced: now,
            },
          },
          null,
          2
        ),
        ContentType: "application/json",
      })
    );
    return {
      kind: "github",
      key: provenance.key,
      repo: provenance.repo,
      repoPath: provenance.repoPath,
      beforeSha: provenance.blobSha,
      afterSha,
    };
  },
};

const s3Solutioner: Solutioner = {
  kind: "manual",
  canHandle: (p) => p.kind === "manual",
  apply: async (_scope, bucket, target) => {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: target.provenance.key,
        Body: target.body,
        ContentType: "text/markdown; charset=utf-8",
      })
    );
    return { kind: "s3", key: target.provenance.key };
  },
};

const notionSolutioner: Solutioner = {
  kind: "notion",
  canHandle: (p) => p.kind === "notion",
  apply: async () => {
    throw new ConflictFailure({
      kind: "unwritable-loser",
      provenanceKind: "notion",
    });
  },
};

const googleSolutioner: Solutioner = {
  kind: "google",
  canHandle: (p) => p.kind === "google",
  apply: async () => {
    throw new ConflictFailure({
      kind: "unwritable-loser",
      provenanceKind: "google",
    });
  },
};

const SOLUTIONERS: Solutioner[] = [
  githubSolutioner,
  s3Solutioner,
  notionSolutioner,
  googleSolutioner,
];

export function solutionerFor(p: Provenance): Solutioner {
  const found = SOLUTIONERS.find((s) => s.canHandle(p));
  if (!found) throw new Error(`no solutioner for ${p.kind}`);
  return found;
}

export async function applyWrites(
  scope: ConflictScope,
  docsBucket: string,
  targets: WriteTarget[]
): Promise<WriteReceipt[]> {
  const githubFirst = [
    ...targets.filter((t) => t.provenance.kind === "github"),
    ...targets.filter((t) => t.provenance.kind !== "github"),
  ];
  const wrote: WriteReceipt[] = [];
  for (const target of githubFirst) {
    wrote.push(await solutionerFor(target.provenance).apply(scope, docsBucket, target));
  }
  return wrote;
}

export function pinFromApply(input: {
  conflict: Conflict;
  resolution: Resolution;
  wrote: WriteReceipt[];
  outcome: "accepted" | "rejected";
}): Pin {
  const hashes = hashesAfter(input.conflict, input.resolution);
  const githubBlobShas: Pin["githubBlobShas"] = {};
  for (const receipt of input.wrote) {
    if (receipt.kind !== "github") continue;
    if (receipt.key === input.conflict.left.provenance.key) {
      githubBlobShas.left = receipt.afterSha;
    }
    if (receipt.key === input.conflict.right.provenance.key) {
      githubBlobShas.right = receipt.afterSha;
    }
  }
  return {
    fingerprint: input.conflict.fingerprint,
    outcome: input.outcome,
    leftKey: input.conflict.left.provenance.key,
    rightKey: input.conflict.right.provenance.key,
    topic: input.conflict.topic,
    hashes,
    githubBlobShas,
    conflictId: input.conflict.id,
    pinnedAt: new Date(),
  };
}

function hashesAfter(
  conflict: Conflict,
  resolution: Resolution
): { left: string; right: string } {
  if (resolution.kind === "keep") {
    const loser = loserSide(resolution.winner);
    return {
      left:
        loser === "left"
          ? canonicalHash(resolution.loserBody)
          : conflict.left.canonicalHash,
      right:
        loser === "right"
          ? canonicalHash(resolution.loserBody)
          : conflict.right.canonicalHash,
    };
  }
  return {
    left: canonicalHash(resolution.leftBody),
    right: canonicalHash(resolution.rightBody),
  };
}

export async function loadObjectText(
  bucket: string,
  key: string
): Promise<string | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return (await res.Body?.transformToString("utf-8")) ?? "";
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode;
    const name = (err as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound" || status === 404) {
      return null;
    }
    throw err;
  }
}
