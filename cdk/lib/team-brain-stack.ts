import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as bedrock from "aws-cdk-lib/aws-bedrock";

/**
 * Team Brain — shared team knowledge base.
 *
 * Stack:
 *   S3 docs bucket  →  Bedrock KB (Titan embed v2)  →  S3 Vectors index
 *                       ↑
 *                   Lambda auto-ingests on S3 PutObject
 */
export class TeamBrainStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const namePrefix = "team-brain";
    const embedDim = 1024;
    const embedModelArn = `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`;

    // ── 1. Docs bucket (source of truth for markdown) ────────────────
    const docsBucket = new s3.Bucket(this, "DocsBucket", {
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // don't nuke docs on stack delete
    });

    // ── 2. S3 Vectors bucket + index ─────────────────────────────────
    // No L2 constructs exist yet for S3 Vectors — use L1 CfnResource.
    const vectorBucketName = `${namePrefix}-vectors-${this.account}`;
    const indexName = `${namePrefix}-index`;

    const vectorBucket = new cdk.CfnResource(this, "VectorBucket", {
      type: "AWS::S3Vectors::VectorBucket",
      properties: {
        VectorBucketName: vectorBucketName,
      },
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
      name: namePrefix,
      description: "Shared team knowledge base",
      roleArn: kbRole.roleArn,
      knowledgeBaseConfiguration: {
        type: "VECTOR",
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: embedModelArn,
          embeddingModelConfiguration: {
            bedrockEmbeddingModelConfiguration: {
              dimensions: embedDim,
            },
          },
        },
      },
      storageConfiguration: {
        type: "S3_VECTORS",
        s3VectorsConfiguration: {
          indexArn: vectorIndexArn,
        },
      },
    });
    kb.addDependency(vectorIndex);
    kb.node.addDependency(kbRole);

    // ── 5. Data source (points KB at docs bucket) ─────────────────────
    const dataSource = new bedrock.CfnDataSource(this, "DataSource", {
      knowledgeBaseId: kb.attrKnowledgeBaseId,
      name: "markdown-docs",
      dataSourceConfiguration: {
        type: "S3",
        s3Configuration: {
          bucketArn: docsBucket.bucketArn,
        },
      },
      // Default fixed-size chunking; bump to hierarchical/semantic later.
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

    // ── 7. Outputs ────────────────────────────────────────────────────
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
