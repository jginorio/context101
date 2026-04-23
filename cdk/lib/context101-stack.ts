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
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as events from "aws-cdk-lib/aws-events";
import * as events_targets from "aws-cdk-lib/aws-events-targets";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
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

    // ── 1a. Suggestions table ────────────────────────────────────────
    //      Agents (via the MCP tool `suggest_knowledge`) write rows
    //      here. The web admin lists / approves / rejects them. On
    //      approval, the web route writes the content to the docs
    //      bucket and flips status to `accepted`.
    const suggestionsTable = new dynamodb.TableV2(this, "SuggestionsTable", {
      tableName: `${namePrefix}-suggestions`,
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      globalSecondaryIndexes: [
        {
          // Lets the UI list all suggestions in a given status newest first.
          indexName: "status-created_at-index",
          partitionKey: { name: "status", type: dynamodb.AttributeType.STRING },
          sortKey: { name: "created_at", type: dynamodb.AttributeType.STRING },
        },
      ],
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

    // ── Wiki generator (Fargate + EventBridge schedule) ───────────────
    //      Periodically synthesizes the raw markdown corpus into a
    //      structured wiki under s3://docsBucket/wiki/. Triggered on a
    //      schedule; also invocable on-demand from the web UI via
    //      ecs:RunTask (see SSR role grants in section 9).

    // a) Minimal VPC — public subnets only, no NAT (zero idle cost).
    //    The task has short-lived outbound needs (S3 + Bedrock), so
    //    assignPublicIp is enough and saves ~$32/mo vs a NAT gateway.
    const wikiVpc = new ec2.Vpc(this, "WikiGenVpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
      ],
    });

    // b) ECS cluster (free; only tasks incur cost)
    const wikiCluster = new ecs.Cluster(this, "WikiGenCluster", {
      vpc: wikiVpc,
      clusterName: `${namePrefix}-wiki`,
    });

    // c) Container image from wiki-generator/
    const wikiImage = new ecr_assets.DockerImageAsset(this, "WikiGenImage", {
      directory: path.resolve(__dirname, "..", "..", "wiki-generator"),
      platform: ecr_assets.Platform.LINUX_AMD64,
    });

    // d) Task role — what the generator container can do at runtime
    const wikiTaskRole = new iam.Role(this, "WikiGenTaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "Runtime role for the Context101 wiki generator",
    });
    wikiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "ListDocsBucket",
        actions: ["s3:ListBucket"],
        resources: [docsBucket.bucketArn],
      })
    );
    wikiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "RwDocsObjects",
        actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        resources: [`${docsBucket.bucketArn}/*`],
      })
    );
    // Same Opus + marketplace grants as the SSR compute role. Wildcard
    // ARN suffix handles Opus version bumps; cross-region inference
    // profiles are per-account.
    wikiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "InvokeClaudeOpus",
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ],
        resources: [
          `arn:aws:bedrock:*::foundation-model/anthropic.claude-opus-4-7*`,
          `arn:aws:bedrock:*:${this.account}:inference-profile/*claude-opus-4-7*`,
        ],
      })
    );
    wikiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "BedrockMarketplaceCheck",
        actions: [
          "aws-marketplace:ViewSubscriptions",
          "aws-marketplace:Subscribe",
          "aws-marketplace:Unsubscribe",
        ],
        resources: ["*"],
      })
    );

    // e) CloudWatch log group
    const wikiLogGroup = new logs.LogGroup(this, "WikiGenLogs", {
      logGroupName: `/ecs/${namePrefix}-wiki`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // f) Task definition — 0.5 vCPU / 1 GB. Generator is I/O-bound
    //    (Opus latency dominates); CPU/memory are incidental.
    const wikiTaskDef = new ecs.FargateTaskDefinition(this, "WikiGenTaskDef", {
      cpu: 512,
      memoryLimitMiB: 1024,
      taskRole: wikiTaskRole,
    });
    wikiTaskDef.addContainer("generator", {
      image: ecs.ContainerImage.fromDockerImageAsset(wikiImage),
      logging: ecs.LogDrivers.awsLogs({
        logGroup: wikiLogGroup,
        streamPrefix: "generator",
      }),
      environment: {
        AWS_REGION: this.region,
        DOCS_BUCKET: docsBucket.bucketName,
        WIKI_PREFIX: "wiki/",
        MODEL_ID: "us.anthropic.claude-opus-4-7",
      },
    });

    // g) Security group — outbound only (AWS API calls)
    const wikiSg = new ec2.SecurityGroup(this, "WikiGenSg", {
      vpc: wikiVpc,
      description: "Context101 wiki generator Fargate task",
      allowAllOutbound: true,
    });

    // h) EventBridge rule — scheduled run every 10h
    new events.Rule(this, "WikiGenSchedule", {
      description: "Regenerate the Context101 wiki every 10h",
      schedule: events.Schedule.rate(cdk.Duration.hours(10)),
      targets: [
        new events_targets.EcsTask({
          cluster: wikiCluster,
          taskDefinition: wikiTaskDef,
          subnetSelection: { subnetType: ec2.SubnetType.PUBLIC },
          assignPublicIp: true,
          securityGroups: [wikiSg],
        }),
      ],
    });

    new cdk.CfnOutput(this, "WikiGenClusterArn", {
      value: wikiCluster.clusterArn,
      description: "ECS cluster hosting the wiki generator task",
    });
    new cdk.CfnOutput(this, "WikiGenTaskDefArn", {
      value: wikiTaskDef.taskDefinitionArn,
    });
    new cdk.CfnOutput(this, "WikiGenSubnetIds", {
      value: cdk.Fn.join(",", wikiVpc.publicSubnets.map((s) => s.subnetId)),
    });
    new cdk.CfnOutput(this, "WikiGenSecurityGroupId", {
      value: wikiSg.securityGroupId,
    });

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
      // MCP's `suggest_knowledge` tool writes to the Suggestions table.
      suggestionsTable.grantWriteData(instanceRole);

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
                { name: "SUGGESTIONS_TABLE", value: suggestionsTable.tableName },
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
          { name: "SUGGESTIONS_TABLE", value: suggestionsTable.tableName },
          // AWS_REGION can't be set — Amplify reserves the "AWS_" prefix.
          // Lambda's runtime sets it automatically, so utils/s3.ts picks
          // it up from process.env.AWS_REGION without us configuring it.
          { name: "AMPLIFY_MONOREPO_APP_ROOT", value: "web" },
          // Wiki generator plumbing — the "Refresh now" button on /wiki
          // calls ecs:RunTask against this task def in this cluster.
          { name: "WIKI_CLUSTER_ARN", value: wikiCluster.clusterArn },
          { name: "WIKI_TASK_DEF_ARN", value: wikiTaskDef.taskDefinitionArn },
          {
            name: "WIKI_SUBNET_IDS",
            value: cdk.Fn.join(
              ",",
              wikiVpc.publicSubnets.map((s) => s.subnetId)
            ),
          },
          { name: "WIKI_SECURITY_GROUP_ID", value: wikiSg.securityGroupId },
          // Name must match the functionName we set on StartWikiGenFn
          // below (can't use a CfnRef — it would create a cycle since
          // the Lambda is declared after the App).
          { name: "START_WIKI_GEN_FN_NAME", value: `${namePrefix}-start-wiki-gen` },
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
      // cross-region inference-profile ARNs. We use a wildcard on the
      // suffix because AWS uses different naming for different Opus
      // versions (e.g. claude-opus-4-7 vs claude-opus-4-5-20251101-v1:0).
      ssrComputeRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "InvokeClaudeOpus",
          actions: [
            "bedrock:InvokeModel",
            "bedrock:InvokeModelWithResponseStream",
          ],
          resources: [
            `arn:aws:bedrock:*::foundation-model/anthropic.claude-opus-4-7*`,
            `arn:aws:bedrock:*:${this.account}:inference-profile/*claude-opus-4-7*`,
          ],
        })
      );
      // Bedrock validates the Anthropic model subscription via AWS
      // Marketplace on each cold-start invoke. Without these actions the
      // Lambda gets "not authorized to perform aws-marketplace:Subscribe".
      // These actions don't support resource-level scoping.
      ssrComputeRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "BedrockMarketplaceCheck",
          actions: [
            "aws-marketplace:ViewSubscriptions",
            "aws-marketplace:Subscribe",
            "aws-marketplace:Unsubscribe",
          ],
          resources: ["*"],
        })
      );
      // Suggestions table — SSR lists (GSI query), reads for diff, and
      // updates status on approve/reject.
      suggestionsTable.grantReadWriteData(ssrComputeRole);
      // "Refresh now" button on /wiki — SSR invokes a dispatcher Lambda
      // that does the ecs:RunTask. Amplify Hosting's SSR compute role
      // gets a platform session policy applied that explicitly denies
      // iam:PassRole, so calling RunTask directly from SSR fails. The
      // dispatcher Lambda has its own role without that deny.
      const startWikiGenFn = new lambda.Function(this, "StartWikiGenFn", {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "index.handler",
        code: lambda.Code.fromAsset("lambda/start-wiki-gen"),
        functionName: `${namePrefix}-start-wiki-gen`,
        timeout: cdk.Duration.seconds(20),
        environment: {
          WIKI_CLUSTER_ARN: wikiCluster.clusterArn,
          WIKI_TASK_DEF_ARN: wikiTaskDef.taskDefinitionArn,
          WIKI_SUBNET_IDS: wikiVpc.publicSubnets.map((s) => s.subnetId).join(","),
          WIKI_SECURITY_GROUP_ID: wikiSg.securityGroupId,
        },
      });
      startWikiGenFn.addToRolePolicy(
        new iam.PolicyStatement({
          sid: "RunWikiGenerator",
          actions: ["ecs:RunTask"],
          resources: [wikiTaskDef.taskDefinitionArn],
        })
      );
      startWikiGenFn.addToRolePolicy(
        new iam.PolicyStatement({
          sid: "PassWikiGenRoles",
          actions: ["iam:PassRole"],
          resources: [
            wikiTaskRole.roleArn,
            wikiTaskDef.executionRole!.roleArn,
          ],
        })
      );

      // SSR can invoke the dispatcher + describe tasks for polling
      startWikiGenFn.grantInvoke(ssrComputeRole);
      ssrComputeRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "DescribeWikiTasks",
          actions: ["ecs:DescribeTasks"],
          resources: [
            `arn:aws:ecs:${this.region}:${this.account}:task/${wikiCluster.clusterName}/*`,
          ],
        })
      );

      new cdk.CfnOutput(this, "StartWikiGenFnName", {
        value: startWikiGenFn.functionName,
      });

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
