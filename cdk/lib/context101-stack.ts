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
import * as amplify from "aws-cdk-lib/aws-amplify";
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

    // ── 9. Optional: Amplify Hosting for the web admin UI ─────────────
    //      Only provisioned if -c githubToken=<pat> is passed.
    const githubToken = this.node.tryGetContext("githubToken") as
      | string
      | undefined;

    if (githubToken) {
      // a) Service role Amplify uses during builds (runs `ampx pipeline-deploy`,
      //    which provisions the prod Cognito pool via CloudFormation).
      const amplifyServiceRole = new iam.Role(this, "AmplifyServiceRole", {
        assumedBy: new iam.ServicePrincipal("amplify.amazonaws.com"),
        description:
          "Used by Amplify Hosting during builds for backend deploys",
      });
      amplifyServiceRole.addManagedPolicy(
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmplifyBackendDeployFullAccess"
        )
      );
      // Amplify itself (not our SSR code) uses THIS role to deliver SSR
      // hosting compute logs to CloudWatch. Without these perms, log groups
      // never get created. See:
      // https://github.com/aws-amplify/amplify-hosting/issues/3964
      amplifyServiceRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "AmplifyDeliverLogs",
          actions: [
            "logs:CreateLogStream",
            "logs:CreateLogGroup",
            "logs:DescribeLogGroups",
            "logs:PutLogEvents",
          ],
          resources: ["arn:aws:logs:*:*:*"],
        })
      );

      // b) Amplify App — points at the GitHub repo
      const webApp = new amplify.CfnApp(this, "WebApp", {
        name: `${namePrefix}-web`,
        description: "Context101 knowledge admin UI",
        repository: "https://github.com/jginorio/context101",
        accessToken: githubToken,
        iamServiceRole: amplifyServiceRole.roleArn,
        platform: "WEB_COMPUTE", // Next.js SSR
        environmentVariables: [
          { name: "DOCS_BUCKET", value: docsBucket.bucketName },
          // AWS_REGION can't be set — Amplify reserves the "AWS_" prefix.
          // Lambda's runtime sets it automatically, so utils/s3.ts picks
          // it up from process.env.AWS_REGION without us configuring it.
          { name: "AMPLIFY_MONOREPO_APP_ROOT", value: "web" },
        ],
      });

      // c) Branch — tracks main and auto-builds on push
      const mainBranch = new amplify.CfnBranch(this, "WebAppMain", {
        appId: webApp.attrAppId,
        branchName: "main",
        stage: "PRODUCTION",
        enableAutoBuild: true,
        framework: "Next.js - SSR",
      });
      mainBranch.addDependency(webApp);

      // d) SSR Compute role — the IAM role the Amplify Hosting compute
      //    Lambda assumes at runtime. Granting it S3 perms on the docs
      //    bucket means API routes don't need access keys, and any writes
      //    are attributable via CloudTrail. Also grants logs:* so SSR
      //    logs land in CloudWatch.
      const ssrComputeRole = new iam.Role(this, "WebSsrComputeRole", {
        roleName: `${namePrefix}-web-ssr-compute`,
        assumedBy: new iam.ServicePrincipal("amplify.amazonaws.com"),
        description: "Runtime role for the Amplify Hosting SSR compute",
      });
      ssrComputeRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "ListDocsBucket",
          actions: ["s3:ListBucket"],
          resources: [docsBucket.bucketArn],
        })
      );
      ssrComputeRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "RwDocsObjects",
          actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
          resources: [`${docsBucket.bucketArn}/*`],
        })
      );
      // CloudWatch Logs perms. DescribeLogGroups needs resource "*"
      // (you can't describe a specific log group by ARN); the write
      // actions are tighter-scoped.
      ssrComputeRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "DescribeAnyLogGroup",
          actions: ["logs:DescribeLogGroups"],
          resources: ["*"],
        })
      );
      ssrComputeRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "WriteAmplifyLogs",
          actions: [
            "logs:CreateLogGroup",
            "logs:CreateLogStream",
            "logs:PutLogEvents",
          ],
          resources: [
            `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/amplify/*`,
            `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/amplify/*:log-stream:*`,
          ],
        })
      );
      // Invoke Claude Opus 4.7 via Bedrock — used by the "Improve with AI"
      // button in the web UI. Grant both the foundation model and
      // inference-profile ARNs so either routing path works.
      ssrComputeRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "InvokeClaudeOpus",
          actions: ["bedrock:InvokeModel"],
          resources: [
            `arn:aws:bedrock:*::foundation-model/anthropic.claude-opus-4-7-v1:0`,
            `arn:aws:bedrock:*:${this.account}:inference-profile/*.anthropic.claude-opus-4-7-v1:0`,
          ],
        })
      );

      // Attach the compute role to the Amplify App
      webApp.addPropertyOverride("ComputeRoleArn", ssrComputeRole.roleArn);
      webApp.node.addDependency(ssrComputeRole);

      new cdk.CfnOutput(this, "WebAppId", {
        value: webApp.attrAppId,
        description: "Amplify App ID (for the AWS console + CLI)",
      });
      new cdk.CfnOutput(this, "WebAppDefaultDomain", {
        value: cdk.Fn.join("", [
          "https://main.",
          webApp.attrDefaultDomain,
        ]),
        description: "The web admin URL once the first build finishes.",
      });
      new cdk.CfnOutput(this, "WebSsrComputeRoleArn", {
        value: ssrComputeRole.roleArn,
        description:
          "IAM role the Amplify SSR Lambda runs under. Has S3 docs bucket + CloudWatch logs perms.",
      });
    }

    // ── 10. Outputs ───────────────────────────────────────────────────
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
