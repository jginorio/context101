import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as path from "path";
import { execSync } from "node:child_process";

/**
 * Shared control-plane primitives for the multi-brain system.
 *
 *   • brainProvisionerFn   — owns IAM for runtime creation/deletion of
 *                            per-brain resources (S3 bucket, KB, vector
 *                            index, bearer-token secret) and writes the
 *                            brain row to the Postgres `brains` registry
 *                            (the control-plane source of truth).
 *
 * Resource naming: every per-brain resource follows the pattern
 * `context101-brain-<brain_id>-…`. IAM on the provisioner is scoped to
 * that pattern via wildcards, so the Lambda can't touch anything else.
 */

export interface BrainSharedProps {
  namePrefix: string;
  embedModelArn: string;
  embedDim: number;
  vectorBucketName: string;
  vectorBucketArn: string;
  // The shared KB role used by every brain's KB. Created in the parent
  // stack so its policies can be widened to include existing default-brain
  // resources too.
  sharedKbRoleArn: string;
  // The auto-ingest Lambda — provisioner adds S3 notifications pointed at it.
  autoIngestFn: lambda.IFunction;
  // Shared Neon-over-HTTP helper layer + connection string. The provisioner
  // writes the brain registry row to Postgres.
  pgHttpLayer: lambda.ILayerVersion;
  databaseUrl?: string;
}

export class BrainShared extends Construct {
  public readonly provisionerFn: lambda.Function;

  constructor(scope: Construct, id: string, props: BrainSharedProps) {
    super(scope, id);

    // ── BrainProvisionerFn — runtime create/delete handler ─────────────
    //
    // The Lambda Node 20 runtime preinstalls a curated subset of
    // @aws-sdk/* v3 clients (s3, dynamodb, secrets-manager, etc.) but
    // NOT newer ones — @aws-sdk/client-s3-vectors isn't in the set.
    // Without bundling, the deploy artifact is just index.mjs +
    // package.json and the function crashes on cold start with
    // ERR_MODULE_NOT_FOUND ("Cannot find package '@aws-sdk/client-s3-vectors'").
    //
    // Bundling runs `npm install --omit=dev` to produce the node_modules.
    //
    // The provisioner's only deps are pure-JS AWS SDK v3 clients (no native
    // binaries), so a host-side `npm install` is byte-for-byte runtime
    // compatible with Lambda's Node 20. We therefore prefer LOCAL bundling
    // (no container needed) and fall back to the Docker/OCI image only if the
    // local install fails. This keeps synth working on machines where the
    // container VM is flaky/unavailable, while remaining identical in CI.
    const provisionerSrc = path.resolve(
      __dirname,
      "..",
      "lambda",
      "brain-provisioner"
    );
    this.provisionerFn = new lambda.Function(this, "BrainProvisionerFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(provisionerSrc, {
        bundling: {
          image: lambda.Runtime.NODEJS_20_X.bundlingImage,
          // Docker/OCI fallback (CI or when local bundling is unavailable).
          // HOME=/tmp keeps npm's cache writable inside the sam image (its
          // default /.npm is root-owned and 400s with EACCES under the
          // host uid/gid mapping).
          environment: {
            HOME: "/tmp",
            npm_config_cache: "/tmp/.npm",
            npm_config_update_notifier: "false",
          },
          command: [
            "bash",
            "-c",
            "cp -au . /asset-output && cd /asset-output && npm install --omit=dev --no-audit --no-fund --loglevel=error",
          ],
          // Preferred path: install directly on the host into the asset
          // staging dir. Returning true skips the container entirely.
          local: {
            tryBundle(outputDir: string): boolean {
              try {
                execSync(
                  `cp -a "${provisionerSrc}/." "${outputDir}/" && cd "${outputDir}" && npm install --omit=dev --no-audit --no-fund --loglevel=error`,
                  {
                    stdio: "inherit",
                    env: {
                      ...process.env,
                      npm_config_update_notifier: "false",
                    },
                  }
                );
                return true;
              } catch {
                // Fall back to the Docker/OCI image bundling above.
                return false;
              }
            },
          },
        },
      }),
      functionName: `${props.namePrefix}-brain-provisioner`,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      layers: [props.pgHttpLayer],
      environment: {
        // The brain registry lives in Postgres; the provisioner writes the
        // row over HTTP via DATABASE_URL (no DynamoDB).
        AWS_ACCOUNT_ID: cdk.Stack.of(this).account,
        VECTOR_BUCKET_NAME: props.vectorBucketName,
        SHARED_KB_ROLE_ARN: props.sharedKbRoleArn,
        AUTO_INGEST_FN_ARN: props.autoIngestFn.functionArn,
        EMBED_MODEL_ARN: props.embedModelArn,
        EMBED_DIM: String(props.embedDim),
        ...(props.databaseUrl ? { DATABASE_URL: props.databaseUrl } : {}),
      },
    });

    // S3: create/delete brain-specific buckets and configure them.
    this.provisionerFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "ManageBrainBuckets",
        // S3 has a handful of API↔IAM-action name divergences. The S3
        // SDK calls PutBucketEncryption / GetBucketEncryption, but the
        // IAM permissions are s3:PutEncryptionConfiguration /
        // s3:GetEncryptionConfiguration. Granted both forms here so the
        // provisioner doesn't get a cryptic AccessDenied when it tries
        // to turn on bucket encryption on a fresh brain bucket.
        actions: [
          "s3:CreateBucket",
          "s3:DeleteBucket",
          "s3:PutBucketVersioning",
          "s3:PutEncryptionConfiguration",
          "s3:GetEncryptionConfiguration",
          "s3:PutBucketPublicAccessBlock",
          "s3:GetBucketPublicAccessBlock",
          // Bucket-notification has both legacy and new IAM spellings;
          // S3 server-side authorizes against s3:PutBucketNotification
          // (the legacy name) even when the SDK calls the modern
          // PutBucketNotificationConfiguration API. Grant both so the
          // authz check is satisfied regardless of which name AWS uses
          // at the time.
          "s3:PutBucketNotification",
          "s3:PutBucketNotificationConfiguration",
          "s3:GetBucketNotification",
          "s3:GetBucketNotificationConfiguration",
          "s3:ListBucket",
          "s3:ListBucketVersions",
          "s3:GetObject",
          // PutObject is needed by the replace/clone flow, which copies a
          // source brain's docs into the replacement brain's bucket.
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:DeleteObjectVersion",
        ],
        resources: [
          `arn:aws:s3:::${props.namePrefix}-brain-*`,
          `arn:aws:s3:::${props.namePrefix}-brain-*/*`,
        ],
      })
    );

    // S3 Vectors: create/delete indexes inside the shared vector bucket.
    this.provisionerFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "ManageBrainVectorIndexes",
        actions: [
          "s3vectors:CreateIndex",
          "s3vectors:DeleteIndex",
          "s3vectors:GetIndex",
          "s3vectors:ListIndexes",
          "s3vectors:GetVectorBucket",
        ],
        resources: [
          props.vectorBucketArn,
          `${props.vectorBucketArn}/index/${props.namePrefix}-brain-*`,
        ],
      })
    );

    // Bedrock Agent control-plane: create/delete KBs and data sources.
    // These actions don't support resource-level scoping for Create*; the
    // KB IAM role is the real gate (and pass-role is locked to SharedKbRole).
    this.provisionerFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "ManageBrainKnowledgeBases",
        actions: [
          "bedrock:CreateKnowledgeBase",
          "bedrock:CreateDataSource",
          "bedrock:DeleteKnowledgeBase",
          "bedrock:DeleteDataSource",
          "bedrock:GetKnowledgeBase",
          "bedrock:GetDataSource",
          "bedrock:UpdateKnowledgeBase",
          "bedrock:UpdateDataSource",
          "bedrock:ListKnowledgeBases",
          "bedrock:ListDataSources",
          // StartIngestionJob is invoked by the replace/clone flow to embed
          // the copied content under the replacement brain's new settings.
          "bedrock:StartIngestionJob",
          "bedrock:TagResource",
        ],
        resources: ["*"],
      })
    );

    // Pass the shared KB role to Bedrock on CreateKnowledgeBase. Scoped
    // to exactly that role, so the provisioner can't pass any other role.
    this.provisionerFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "PassSharedKbRole",
        actions: ["iam:PassRole"],
        resources: [props.sharedKbRoleArn],
        conditions: {
          StringEquals: { "iam:PassedToService": "bedrock.amazonaws.com" },
        },
      })
    );

    // Secrets Manager: create/delete per-brain bearer tokens.
    const stackAcct = cdk.Stack.of(this).account;
    const stackRegion = cdk.Stack.of(this).region;
    this.provisionerFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "ManageBrainTokenSecrets",
        actions: [
          "secretsmanager:CreateSecret",
          "secretsmanager:DeleteSecret",
          "secretsmanager:PutSecretValue",
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
          "secretsmanager:TagResource",
        ],
        resources: [
          `arn:aws:secretsmanager:${stackRegion}:${stackAcct}:secret:${props.namePrefix}-brain-*`,
        ],
      })
    );
    // CreateSecret needs the resource-less action to pass a wildcard name check.
    this.provisionerFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "CreateBrainTokenSecretsName",
        actions: ["secretsmanager:CreateSecret"],
        resources: ["*"],
        conditions: {
          StringLike: {
            "secretsmanager:Name": `${props.namePrefix}-brain-*`,
          },
        },
      })
    );

    // Lambda: allow the provisioner to add/remove the per-bucket invoke
    // permission on the auto-ingest Lambda (each new brain bucket adds a
    // ResourcePolicy statement so S3 → Lambda invocation is permitted).
    this.provisionerFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "ManageAutoIngestPermission",
        actions: ["lambda:AddPermission", "lambda:RemovePermission"],
        resources: [props.autoIngestFn.functionArn],
      })
    );

    // The `default` brain row already lives in the Postgres `brains`
    // registry (seeded during the migration off DynamoDB). New brains are
    // written there by the provisioner, so there's no CDK-managed
    // registration step anymore.
  }
}
