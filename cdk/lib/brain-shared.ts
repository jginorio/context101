import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as cr from "aws-cdk-lib/custom-resources";
import * as path from "path";

/**
 * Shared control-plane primitives for the multi-brain system.
 *
 *   • BrainsTable          — registry of brains. One row per brain.
 *   • brainProvisionerFn   — owns IAM for runtime creation/deletion of
 *                            per-brain resources (S3 bucket, KB, vector
 *                            index, DDB tables, bearer-token secret).
 *   • registerDefaultBrain — one-shot custom resource that inserts the
 *                            existing single brain's resources into
 *                            BrainsTable as `brain_id="default"`. Idempotent.
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
  // Default brain registration inputs.
  defaultBrain: {
    docsBucket: string;
    kbId: string;
    dsId: string;
    vectorIndexArn: string;
    suggestionsTable: string;
    connectorsTable: string;
    tokenSecretArn: string;
  };
}

export class BrainShared extends Construct {
  public readonly brainsTable: dynamodb.TableV2;
  public readonly provisionerFn: lambda.Function;

  constructor(scope: Construct, id: string, props: BrainSharedProps) {
    super(scope, id);

    // ── BrainsTable — global registry ───────────────────────────────────
    this.brainsTable = new dynamodb.TableV2(this, "BrainsTable", {
      tableName: `${props.namePrefix}-brains`,
      partitionKey: { name: "brain_id", type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      globalSecondaryIndexes: [
        {
          // List brains by status (e.g. status=ready, newest first) without
          // scanning. The web UI uses this for the switcher dropdown.
          indexName: "status-created_at-index",
          partitionKey: { name: "status", type: dynamodb.AttributeType.STRING },
          sortKey: { name: "created_at", type: dynamodb.AttributeType.STRING },
        },
      ],
    });

    // ── BrainProvisionerFn — runtime create/delete handler ─────────────
    //
    // The Lambda Node 20 runtime preinstalls a curated subset of
    // @aws-sdk/* v3 clients (s3, dynamodb, secrets-manager, etc.) but
    // NOT newer ones — @aws-sdk/client-s3-vectors isn't in the set.
    // Without bundling, the deploy artifact is just index.mjs +
    // package.json and the function crashes on cold start with
    // ERR_MODULE_NOT_FOUND ("Cannot find package '@aws-sdk/client-s3-vectors'").
    //
    // Bundling runs `npm install --omit=dev` inside the Lambda's own
    // Node 20 image so the resulting node_modules is binary-compatible
    // with the runtime. Requires Docker at synth time — already a
    // prereq for the wiki-generator image asset, so no new dependency.
    this.provisionerFn = new lambda.Function(this, "BrainProvisionerFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(
        path.resolve(__dirname, "..", "lambda", "brain-provisioner"),
        {
          bundling: {
            image: lambda.Runtime.NODEJS_20_X.bundlingImage,
            // The bundler container runs as the host user (uid/gid
            // forwarded from the developer's machine) but the default
            // npm cache lives at /.npm which is root-owned in the
            // sam/build-nodejs20.x image — npm errors out with EACCES
            // mkdir /.npm. Point HOME at /tmp so npm caches under
            // /tmp/.npm (always world-writable). Same trick for the
            // npm config root via the env var override.
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
          },
        }
      ),
      functionName: `${props.namePrefix}-brain-provisioner`,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        BRAINS_TABLE: this.brainsTable.tableName,
        AWS_ACCOUNT_ID: cdk.Stack.of(this).account,
        VECTOR_BUCKET_NAME: props.vectorBucketName,
        SHARED_KB_ROLE_ARN: props.sharedKbRoleArn,
        AUTO_INGEST_FN_ARN: props.autoIngestFn.functionArn,
        EMBED_MODEL_ARN: props.embedModelArn,
        EMBED_DIM: String(props.embedDim),
      },
    });

    this.brainsTable.grantReadWriteData(this.provisionerFn);

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
          "s3:PutBucketNotificationConfiguration",
          "s3:GetBucketNotificationConfiguration",
          "s3:ListBucket",
          "s3:ListBucketVersions",
          "s3:GetObject",
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

    // DynamoDB: create/delete per-brain tables.
    const stackAcct = cdk.Stack.of(this).account;
    const stackRegion = cdk.Stack.of(this).region;
    this.provisionerFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "ManageBrainTables",
        actions: [
          "dynamodb:CreateTable",
          "dynamodb:DeleteTable",
          "dynamodb:DescribeTable",
          "dynamodb:UpdateTable",
        ],
        resources: [
          `arn:aws:dynamodb:${stackRegion}:${stackAcct}:table/${props.namePrefix}-brain-*`,
        ],
      })
    );

    // Secrets Manager: create/delete per-brain bearer tokens.
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

    // ── RegisterDefaultBrain — one-shot custom resource ─────────────────
    //   Writes a row to BrainsTable mapping `default` → existing resources.
    //   Idempotent via ConditionExpression: attribute_not_exists. On stack
    //   delete it's a no-op (we never want to remove the default brain row
    //   from the registry — the row's deletion is what would orphan the
    //   retained S3/KB resources).
    const isoNow = new Date().toISOString();
    new cr.AwsCustomResource(this, "RegisterDefaultBrain", {
      onCreate: {
        service: "DynamoDB",
        action: "putItem",
        parameters: {
          TableName: this.brainsTable.tableName,
          Item: {
            brain_id: { S: "default" },
            display_name: { S: "Default" },
            status: { S: "ready" },
            created_at: { S: isoNow },
            docs_bucket: { S: props.defaultBrain.docsBucket },
            kb_id: { S: props.defaultBrain.kbId },
            ds_id: { S: props.defaultBrain.dsId },
            vector_index_arn: { S: props.defaultBrain.vectorIndexArn },
            suggestions_table: { S: props.defaultBrain.suggestionsTable },
            connectors_table: { S: props.defaultBrain.connectorsTable },
            token_secret_arn: { S: props.defaultBrain.tokenSecretArn },
          },
          ConditionExpression: "attribute_not_exists(brain_id)",
        },
        physicalResourceId: cr.PhysicalResourceId.of("register-default-brain"),
        // ConditionalCheckFailedException = row already there → success.
        ignoreErrorCodesMatching: "ConditionalCheckFailedException",
      },
      onUpdate: {
        // On stack updates, refresh the row's handles in case the default
        // brain's KB/DS/tables got rewired by a CDK change. Use UpdateItem
        // so we don't clobber created_at / status.
        service: "DynamoDB",
        action: "updateItem",
        parameters: {
          TableName: this.brainsTable.tableName,
          Key: { brain_id: { S: "default" } },
          UpdateExpression:
            "SET docs_bucket = :db, kb_id = :kb, ds_id = :ds, " +
            "vector_index_arn = :vi, suggestions_table = :st, " +
            "connectors_table = :ct, token_secret_arn = :ts",
          ExpressionAttributeValues: {
            ":db": { S: props.defaultBrain.docsBucket },
            ":kb": { S: props.defaultBrain.kbId },
            ":ds": { S: props.defaultBrain.dsId },
            ":vi": { S: props.defaultBrain.vectorIndexArn },
            ":st": { S: props.defaultBrain.suggestionsTable },
            ":ct": { S: props.defaultBrain.connectorsTable },
            ":ts": { S: props.defaultBrain.tokenSecretArn },
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of("register-default-brain"),
      },
      // No onDelete — we deliberately do NOT remove the default row when
      // the stack is destroyed. The retained S3/KB live on, and the row
      // documents how to reattach.
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ["dynamodb:PutItem", "dynamodb:UpdateItem"],
          resources: [this.brainsTable.tableArn],
        }),
      ]),
      installLatestAwsSdk: false,
    });
  }
}
