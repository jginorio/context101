import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import * as apprunner from "aws-cdk-lib/aws-apprunner";
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as path from "path";

/**
 * Context101 — shared team knowledge base.
 *
 *   S3 docs bucket  →  Bedrock KB (Titan embed v2)  →  S3 Vectors index
 *                       ↑
 *                   Lambda auto-ingests on S3 PutObject
 *
 * Optional: if `-c token=<value>` is passed at deploy time, also provisions
 * an App Runner service running the FastMCP server with bearer-token auth.
 */
export class Context101Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const namePrefix = "context101";
    const embedDim = 1024;
    const embedModelArn = `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`;

    // ── 1. Docs bucket (source of truth for markdown) ────────────────
    const docsBucket = new s3.Bucket(this, "DocsBucket", {
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── 2. S3 Vectors bucket + index ─────────────────────────────────
    // Version suffix — bump this whenever a change to the Index config
    // requires replacement (S3 Vectors doesn't support in-place metadata
    // config updates, and Bedrock KB's indexArn is immutable).
    const version = "v2";
    const vectorBucketName = `${namePrefix}-vectors-${this.account}`;
    const indexName = `${namePrefix}-index-${version}`;

    const vectorBucket = new cdk.CfnResource(this, "VectorBucket", {
      type: "AWS::S3Vectors::VectorBucket",
      properties: { VectorBucketName: vectorBucketName },
    });
    vectorBucket.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    const vectorIndex = new cdk.CfnResource(this, "VectorIndex", {
      type: "AWS::S3Vectors::Index",
      properties: {
        VectorBucketName: vectorBucketName,
        IndexName: indexName,
        DataType: "float32",
        Dimension: embedDim,
        DistanceMetric: "cosine",
        // Mark Bedrock-reserved metadata keys as non-filterable so the
        // chunk text doesn't count against the 2KB filterable-metadata
        // per-vector cap. Without this, ingestion fails on any doc
        // whose chunk text is longer than ~2KB.
        MetadataConfiguration: {
          NonFilterableMetadataKeys: [
            "AMAZON_BEDROCK_TEXT",
            "AMAZON_BEDROCK_METADATA",
          ],
        },
      },
    });
    vectorIndex.addDependency(vectorBucket);
    vectorIndex.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    const vectorBucketArn = `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucketName}`;
    const vectorIndexArn = `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucketName}/index/${indexName}`;

    // ── 3. IAM role for the Knowledge Base ────────────────────────────
    const kbRole = new iam.Role(this, "KnowledgeBaseRole", {
      assumedBy: new iam.ServicePrincipal("bedrock.amazonaws.com", {
        conditions: {
          StringEquals: { "aws:SourceAccount": this.account },
          ArnLike: {
            "aws:SourceArn": `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*`,
          },
        },
      }),
    });
    docsBucket.grantRead(kbRole);
    kbRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "InvokeEmbeddingModel",
        actions: ["bedrock:InvokeModel"],
        resources: [embedModelArn],
      })
    );
    kbRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "S3VectorsAccess",
        actions: [
          "s3vectors:GetIndex",
          "s3vectors:ListIndexes",
          "s3vectors:GetVectorBucket",
          "s3vectors:GetVectors",
          "s3vectors:PutVectors",
          "s3vectors:QueryVectors",
          "s3vectors:DeleteVectors",
          "s3vectors:ListVectors",
        ],
        resources: [vectorBucketArn, vectorIndexArn],
      })
    );

    // ── 4. Bedrock Knowledge Base ─────────────────────────────────────
    const kb = new bedrock.CfnKnowledgeBase(this, "KnowledgeBase", {
      name: `${namePrefix}-${version}`,
      description: "Shared team knowledge base",
      roleArn: kbRole.roleArn,
      knowledgeBaseConfiguration: {
        type: "VECTOR",
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: embedModelArn,
          embeddingModelConfiguration: {
            bedrockEmbeddingModelConfiguration: { dimensions: embedDim },
          },
        },
      },
      storageConfiguration: {
        type: "S3_VECTORS",
        s3VectorsConfiguration: { indexArn: vectorIndexArn },
      },
    });
    kb.addDependency(vectorIndex);
    kb.node.addDependency(kbRole);

    // ── 5. Data source ────────────────────────────────────────────────
    const dataSource = new bedrock.CfnDataSource(this, "DataSource", {
      knowledgeBaseId: kb.attrKnowledgeBaseId,
      name: "markdown-docs",
      dataSourceConfiguration: {
        type: "S3",
        s3Configuration: { bucketArn: docsBucket.bucketArn },
      },
    });

    // ── 6. Auto-ingest Lambda ─────────────────────────────────────────
    const ingestFn = new lambda.Function(this, "AutoIngestFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("lambda/auto-ingest"),
      timeout: cdk.Duration.seconds(30),
      environment: {
        KB_ID: kb.attrKnowledgeBaseId,
        DS_ID: dataSource.attrDataSourceId,
      },
    });
    ingestFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:StartIngestionJob"],
        resources: [kb.attrKnowledgeBaseArn],
      })
    );
    docsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(ingestFn)
    );
    docsBucket.addEventNotification(
      s3.EventType.OBJECT_REMOVED,
      new s3n.LambdaDestination(ingestFn)
    );

    // ── 7. Sync local knowledge/ → docs bucket on every deploy ────────
    //      The local knowledge/ folder is the source of truth.
    //      prune: true = S3 files not in knowledge/ get deleted. Matches
    //      the "git repo is source of truth" model.
    const deployment = new s3deploy.BucketDeployment(this, "KnowledgeSync", {
      sources: [
        s3deploy.Source.asset(path.resolve(__dirname, "..", "..", "knowledge")),
      ],
      destinationBucket: docsBucket,
      prune: true,
      retainOnDelete: true, // keep files on stack destroy
    });
    // Ensure the notification → Lambda wiring exists before files land,
    // so the auto-ingest Lambda fires on the initial upload.
    deployment.node.addDependency(ingestFn);

    // ── 8. Optional: App Runner service hosting the MCP server ────────
    //      Only provisioned if -c token=<value> is passed at deploy time.
    const teamToken = this.node.tryGetContext("token") as string | undefined;

    if (teamToken) {
      // a) Store the bearer token in Secrets Manager
      const tokenSecret = new secretsmanager.Secret(this, "TokenSecret", {
        secretName: `${namePrefix}-bearer-token`,
        description: "Shared bearer token for the Context101 MCP server",
        secretStringValue: cdk.SecretValue.unsafePlainText(teamToken),
      });

      // b) Build Docker image from the repo root (parent of cdk/)
      const image = new ecr_assets.DockerImageAsset(this, "McpImage", {
        directory: path.resolve(__dirname, "..", ".."),
        platform: ecr_assets.Platform.LINUX_AMD64,
        file: "Dockerfile",
      });

      // c) App Runner instance role — runtime perms (what the MCP can do)
      const instanceRole = new iam.Role(this, "AppRunnerInstanceRole", {
        assumedBy: new iam.ServicePrincipal("tasks.apprunner.amazonaws.com"),
        description: "Runtime role for the Context101 MCP App Runner service",
      });
      instanceRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "RetrieveFromKb",
          actions: ["bedrock:Retrieve"],
          resources: [kb.attrKnowledgeBaseArn],
        })
      );
      docsBucket.grantRead(instanceRole);
      tokenSecret.grantRead(instanceRole);

      // d) App Runner access role — permission to pull from ECR
      const accessRole = new iam.Role(this, "AppRunnerAccessRole", {
        assumedBy: new iam.ServicePrincipal("build.apprunner.amazonaws.com"),
      });
      accessRole.addManagedPolicy(
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSAppRunnerServicePolicyForECRAccess"
        )
      );

      // e) The service itself
      const service = new apprunner.CfnService(this, "McpService", {
        serviceName: `${namePrefix}-mcp`,
        sourceConfiguration: {
          authenticationConfiguration: { accessRoleArn: accessRole.roleArn },
          autoDeploymentsEnabled: false,
          imageRepository: {
            imageIdentifier: image.imageUri,
            imageRepositoryType: "ECR",
            imageConfiguration: {
              port: "8787",
              runtimeEnvironmentVariables: [
                { name: "AWS_REGION", value: this.region },
                { name: "KB_ID", value: kb.attrKnowledgeBaseId },
                { name: "DOCS_BUCKET", value: docsBucket.bucketName },
              ],
              runtimeEnvironmentSecrets: [
                { name: "CONTEXT101_TOKEN", value: tokenSecret.secretArn },
              ],
            },
          },
        },
        instanceConfiguration: {
          instanceRoleArn: instanceRole.roleArn,
          cpu: "0.25 vCPU",
          memory: "0.5 GB",
        },
        healthCheckConfiguration: { protocol: "TCP" },
      });

      new cdk.CfnOutput(this, "McpUrl", {
        value: cdk.Fn.join("", ["https://", service.attrServiceUrl, "/mcp"]),
        description:
          "Share with the team. Requires Authorization: Bearer <token> header.",
      });
    }

    // ── 9. Outputs ────────────────────────────────────────────────────
    new cdk.CfnOutput(this, "DocsBucketName", {
      value: docsBucket.bucketName,
      description: "Upload markdown files here; Lambda auto-ingests them.",
    });
    new cdk.CfnOutput(this, "KnowledgeBaseId", {
      value: kb.attrKnowledgeBaseId,
      description: "Set as KB_ID env var for the MCP server.",
    });
    new cdk.CfnOutput(this, "DataSourceId", {
      value: dataSource.attrDataSourceId,
    });
    new cdk.CfnOutput(this, "VectorBucketArn", { value: vectorBucketArn });
    new cdk.CfnOutput(this, "VectorIndexArn", { value: vectorIndexArn });
  }
}
