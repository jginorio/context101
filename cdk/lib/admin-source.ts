import * as path from "path";
import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
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
  /**
   * Ready when branch `main` exists. CfnBranch (WebAppMain) must depend
   * on this — an empty CodeCommit repo has no `main`.
   */
  seedMain?: Construct;
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
    // CloudFormation commits this zip to `main` as part of repo CREATE.
    // CREATE_COMPLETE means `main` exists — required before CfnBranch.
    // Later updates to Code are ignored; the CLI force-pushes web/.
    code: codecommit.Code.fromDirectory(
      path.join(__dirname, "admin-seed"),
      "main"
    ),
  });
  // Default is RETAIN. destroy must take CodeCommit with the stack.
  repo.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
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
    seedMain: repo,
  };
}
