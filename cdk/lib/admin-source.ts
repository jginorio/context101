import { Construct } from "constructs";
import * as codecommit from "aws-cdk-lib/aws-codecommit";
import * as iam from "aws-cdk-lib/aws-iam";

export interface AdminSourceProps {
  namePrefix: string;
  /** Optional GitHub (or other git host) override. Requires githubToken. */
  repository?: string | undefined;
  githubToken?: string | undefined;
  serviceRole: iam.IRole;
}

export interface AdminSource {
  repositoryUrl: string;
  accessToken?: string;
  repo?: codecommit.Repository;
  usingCodeCommit: boolean;
}

/**
 * Amplify WEB_COMPUTE source. Default is a CodeCommit repo the user's
 * AWS account owns (IAM / SIGV4 — no githubToken / accessToken).
 * REPOSITORY + githubToken remain an optional override to watch an
 * external repo.
 */
export function provisionAdminSource(
  scope: Construct,
  props: AdminSourceProps
): AdminSource {
  const external = String(props.repository ?? "").trim();
  const token = String(props.githubToken ?? "").trim();

  if (external && token) {
    return {
      repositoryUrl: external,
      accessToken: token,
      usingCodeCommit: false,
    };
  }

  const repo = new codecommit.Repository(scope, "AdminRepo", {
    repositoryName: `${props.namePrefix}-admin`,
    description: "Context101 admin (Amplify WEB_COMPUTE source)",
  });
  repo.grantPull(props.serviceRole);
  props.serviceRole.addToPrincipalPolicy(
    new iam.PolicyStatement({
      sid: "CodeCommitGitPull",
      actions: [
        "codecommit:GitPull",
        "codecommit:GetBranch",
        "codecommit:GetCommit",
        "codecommit:GetRepository",
        "codecommit:ListBranches",
      ],
      resources: [repo.repositoryArn],
    })
  );

  return {
    repositoryUrl: repo.repositoryCloneUrlHttp,
    usingCodeCommit: true,
    repo,
  };
}
