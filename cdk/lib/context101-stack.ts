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
import * as path from "path";
import { BrainShared } from "./brain-shared";

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

    // ── Postgres control plane (Neon) ─────────────────────────────────
    //   The web app + MCP server already read the brain/connector/
    //   suggestion registry from Postgres. The AWS worker Lambdas below
    //   share the same source of truth via a tiny zero-dependency
    //   Neon-over-HTTP helper packaged as a layer (see layers/pg-http).
    //   DATABASE_URL is passed at deploy time via `-c DATABASE_URL=...`
    //   (deploy.sh forwards it from .deploy-env).
    const databaseUrl = this.node.tryGetContext("DATABASE_URL") as
      | string
      | undefined;
    const pgHttpLayer = new lambda.LayerVersion(this, "PgHttpLayer", {
      code: lambda.Code.fromAsset(
        path.resolve(__dirname, "..", "layers", "pg-http")
      ),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      description:
        "Zero-dependency Neon Postgres-over-HTTP helper (pg-http) shared by control-plane Lambdas",
    });
    // Env injected into every worker Lambda that reaches the control plane.
    const pgLambdaEnv: Record<string, string> = databaseUrl
      ? { DATABASE_URL: databaseUrl }
      : {};

    // ── 1. Docs bucket (source of truth for markdown) ────────────────
    const docsBucket = new s3.Bucket(this, "DocsBucket", {
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Suggestions and connectors live in the Postgres control plane
    // (tables `suggestions` / `connectors`), written by the web app + MCP
    // server. They are no longer backed by DynamoDB.

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
    // Widen to every brain's docs bucket — Bedrock reuses this role for every
    // brain's KB (see BrainShared.provisionerFn → CreateKnowledgeBase). The
    // existing default bucket grant above already covers the default brain;
    // this wildcard covers any future brain provisioned at runtime.
    kbRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "ReadBrainBuckets",
        actions: ["s3:GetObject", "s3:ListBucket"],
        resources: [
          `arn:aws:s3:::${namePrefix}-brain-*`,
          `arn:aws:s3:::${namePrefix}-brain-*/*`,
        ],
      })
    );
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
        resources: [
          vectorBucketArn,
          vectorIndexArn,
          // Per-brain indexes provisioned at runtime live inside the same
          // vector bucket but under brain-specific index names.
          `${vectorBucketArn}/index/${namePrefix}-brain-*`,
        ],
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
    //   One shared Lambda — looks the brain up in the Postgres `brains`
    //   registry by the bucket name in the S3 event, fires
    //   StartIngestionJob against that brain's KB. Each brain's bucket
    //   adds a notification + a ResourcePolicy statement on this Lambda
    //   when provisioned (see brain-provisioner). The default brain's
    //   bucket gets the notification wired the regular CDK way below.
    const ingestFn = new lambda.Function(this, "AutoIngestFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("lambda/auto-ingest"),
      timeout: cdk.Duration.seconds(30),
      layers: [pgHttpLayer],
      environment: {
        // Brain lookups come from Postgres (status=ready rows mapped by
        // docs_bucket) via DATABASE_URL.
        ...pgLambdaEnv,
      },
    });
    ingestFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "StartIngestionAnyBrain",
        actions: ["bedrock:StartIngestionJob"],
        // KB ARNs aren't known at synth for runtime-provisioned brains.
        resources: [`arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*`],
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

    // ── 7. Optional: seed local knowledge/ → docs bucket ──────────────
    //      Off by default. Pass `-c seed=true` on a fresh stack to
    //      bootstrap the bucket with the example markdown under
    //      knowledge/. Subsequent deploys should *not* pass the flag —
    //      at runtime the bucket is the source of truth (web UI,
    //      connectors, approved suggestions all write directly to it),
    //      and we don't want to clobber that on `cdk deploy`.
    //
    //      Note for existing stacks that previously had this construct:
    //      removing the BucketDeployment between deploys causes CFN to
    //      delete the custom resource. With `retainOnDelete: true` set
    //      below, the underlying S3 objects are preserved — only the
    //      Lambda + IAM role behind the deployer go away.
    const shouldSeed = this.node.tryGetContext("seed") === "true";
    if (shouldSeed) {
      const deployment = new s3deploy.BucketDeployment(this, "KnowledgeSync", {
        sources: [
          s3deploy.Source.asset(path.resolve(__dirname, "..", "..", "knowledge")),
        ],
        destinationBucket: docsBucket,
        // prune: false — only add/update; never delete files added via the
        // web UI / connectors / approved suggestions.
        prune: false,
        retainOnDelete: true,
      });
      deployment.node.addDependency(ingestFn);
    }

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
        resources: [
          docsBucket.bucketArn,
          // Per-brain buckets — the dispatcher injects DOCS_BUCKET via
          // containerOverrides at RunTask time, so this role needs access
          // to every brain's bucket.
          `arn:aws:s3:::${namePrefix}-brain-*`,
        ],
      })
    );
    wikiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "RwDocsObjects",
        actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        resources: [
          `${docsBucket.bucketArn}/*`,
          `arn:aws:s3:::${namePrefix}-brain-*/*`,
        ],
      })
    );
    // Same Opus + marketplace grants as the SSR compute role. Wildcard
    // ARN suffix handles Opus version bumps; cross-region inference
    // profiles are per-account.
    wikiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "InvokeBedrockModels",
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ],
        // Any in-account foundation model / inference profile, so admins can
        // pick a different Bedrock model for wiki generation in Settings.
        resources: [
          `arn:aws:bedrock:*::foundation-model/*`,
          `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
        ],
      })
    );
    // Bring-your-own wiki model: read the per-brain API key secret that
    // start-wiki-gen passes as LLM_KEY_SECRET_ARN.
    wikiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "ReadBrainLlmKeySecrets",
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${namePrefix}-brain-*-llm-key*`,
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

    // h) EventBridge rule — kept around but DISABLED by default. Wiki
    //    regen costs ~$0.30-0.80 in Opus per run; we'd rather pay it
    //    only when a human clicks "Refresh now" on /wiki. Flip the
    //    `enabled` flag back to `true` (and redeploy) if you want
    //    scheduled regens.
    new events.Rule(this, "WikiGenSchedule", {
      description: "Regenerate the Context101 wiki every 10h (disabled)",
      enabled: false,
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

    // ── Data source connectors (Google Sheets, …) ─────────────────────
    // OAuth client creds are stored by the admin in Secrets Manager as
    // `context101-google-oauth-client` with { client_id, client_secret }.
    // We reference by name so CDK doesn't try to manage the secret value.
    const googleOAuthClientSecret =
      secretsmanager.Secret.fromSecretNameV2(
        this,
        "GoogleOauthClientSecret",
        `${namePrefix}-google-oauth-client`
      );
    // Notion OAuth client creds stored as
    // `context101-notion-oauth-client` with { client_id, client_secret }.
    // Referenced by name — not managed by CDK.
    const notionOAuthClientSecret =
      secretsmanager.Secret.fromSecretNameV2(
        this,
        "NotionOauthClientSecret",
        `${namePrefix}-notion-oauth-client`
      );

    // a) Per-type sync Lambda — Sheets
    const connectorSyncSheetsFn = new lambda.Function(
      this,
      "ConnectorSyncSheetsFn",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "index.handler",
        code: lambda.Code.fromAsset("lambda/connector-sync-sheets"),
        functionName: `${namePrefix}-connector-sync-sheets`,
        timeout: cdk.Duration.minutes(5),
        memorySize: 1024,
        layers: [pgHttpLayer],
        environment: {
          DOCS_BUCKET: docsBucket.bucketName,
          GOOGLE_OAUTH_CLIENT_SECRET_ID:
            googleOAuthClientSecret.secretName,
          ...pgLambdaEnv,
        },
      }
    );
    docsBucket.grantReadWrite(connectorSyncSheetsFn);
    googleOAuthClientSecret.grantRead(connectorSyncSheetsFn);
    // Per-connection refresh-token secrets are named
    // `context101-connector-<uuid>` — give Lambda read on anything under
    // that pattern.
    connectorSyncSheetsFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "ReadConnectorTokenSecrets",
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${namePrefix}-connector-*`,
        ],
      })
    );

    // a2) Per-type sync Lambda — Google Docs
    const connectorSyncDocsFn = new lambda.Function(
      this,
      "ConnectorSyncDocsFn",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "index.handler",
        code: lambda.Code.fromAsset("lambda/connector-sync-docs"),
        functionName: `${namePrefix}-connector-sync-docs`,
        timeout: cdk.Duration.minutes(5),
        memorySize: 1024,
        layers: [pgHttpLayer],
        environment: {
          DOCS_BUCKET: docsBucket.bucketName,
          GOOGLE_OAUTH_CLIENT_SECRET_ID:
            googleOAuthClientSecret.secretName,
          ...pgLambdaEnv,
        },
      }
    );
    docsBucket.grantReadWrite(connectorSyncDocsFn);
    googleOAuthClientSecret.grantRead(connectorSyncDocsFn);
    connectorSyncDocsFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "ReadConnectorTokenSecrets",
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${namePrefix}-connector-*`,
        ],
      })
    );

    // a3) Per-type sync Lambda — Google Slides
    const connectorSyncSlidesFn = new lambda.Function(
      this,
      "ConnectorSyncSlidesFn",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "index.handler",
        code: lambda.Code.fromAsset("lambda/connector-sync-slides"),
        functionName: `${namePrefix}-connector-sync-slides`,
        timeout: cdk.Duration.minutes(5),
        memorySize: 1024,
        layers: [pgHttpLayer],
        environment: {
          DOCS_BUCKET: docsBucket.bucketName,
          GOOGLE_OAUTH_CLIENT_SECRET_ID:
            googleOAuthClientSecret.secretName,
          ...pgLambdaEnv,
        },
      }
    );
    docsBucket.grantReadWrite(connectorSyncSlidesFn);
    googleOAuthClientSecret.grantRead(connectorSyncSlidesFn);
    connectorSyncSlidesFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "ReadConnectorTokenSecrets",
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${namePrefix}-connector-*`,
        ],
      })
    );

    // a5) Per-type sync Lambda — GitHub (PAT-based, no OAuth provider secret)
    const connectorSyncGithubFn = new lambda.Function(
      this,
      "ConnectorSyncGithubFn",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "index.handler",
        code: lambda.Code.fromAsset("lambda/connector-sync-github"),
        functionName: `${namePrefix}-connector-sync-github`,
        // Repos can have hundreds of files; concurrent blob fetches keep
        // wall time bounded but give it room.
        timeout: cdk.Duration.minutes(10),
        memorySize: 1024,
        layers: [pgHttpLayer],
        environment: {
          ...pgLambdaEnv,
          DOCS_BUCKET: docsBucket.bucketName,
          // Layer 2: after a successful sync, fire the per-repo code-wiki
          // Fargate task. The dispatcher Lambda lives inside the
          // if (githubToken) block; if the web stack isn't deployed,
          // this name resolves to a non-existent fn and the sync just
          // logs a warning (the github sync itself still succeeds).
          START_WIKI_GEN_FN_NAME: `${namePrefix}-start-wiki-gen`,
        },
      }
    );
    docsBucket.grantReadWrite(connectorSyncGithubFn);
    connectorSyncGithubFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "ReadConnectorTokenSecrets",
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${namePrefix}-connector-*`,
        ],
      })
    );

    // a4) Per-type sync Lambda — Notion
    const connectorSyncNotionFn = new lambda.Function(
      this,
      "ConnectorSyncNotionFn",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "index.handler",
        code: lambda.Code.fromAsset("lambda/connector-sync-notion"),
        functionName: `${namePrefix}-connector-sync-notion`,
        // Notion blocks are paginated and we walk recursively — give it room
        timeout: cdk.Duration.minutes(10),
        memorySize: 1024,
        layers: [pgHttpLayer],
        environment: {
          DOCS_BUCKET: docsBucket.bucketName,
          ...pgLambdaEnv,
        },
      }
    );
    docsBucket.grantReadWrite(connectorSyncNotionFn);
    connectorSyncNotionFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "ReadConnectorTokenSecrets",
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${namePrefix}-connector-*`,
        ],
      })
    );

    // b) Dispatcher Lambda — enumerates active connectors, fans out
    //    fire-and-forget invokes to the per-type sync Lambda.
    const connectorDispatchFn = new lambda.Function(
      this,
      "ConnectorDispatchFn",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "index.handler",
        code: lambda.Code.fromAsset("lambda/connector-dispatch"),
        functionName: `${namePrefix}-connector-dispatch`,
        timeout: cdk.Duration.seconds(60),
        layers: [pgHttpLayer],
        environment: {
          ...pgLambdaEnv,
          SHEETS_SYNC_FN_NAME: connectorSyncSheetsFn.functionName,
          DOCS_SYNC_FN_NAME: connectorSyncDocsFn.functionName,
          SLIDES_SYNC_FN_NAME: connectorSyncSlidesFn.functionName,
          NOTION_SYNC_FN_NAME: connectorSyncNotionFn.functionName,
          GITHUB_SYNC_FN_NAME: connectorSyncGithubFn.functionName,
        },
      }
    );
    connectorSyncSheetsFn.grantInvoke(connectorDispatchFn);
    connectorSyncDocsFn.grantInvoke(connectorDispatchFn);
    connectorSyncSlidesFn.grantInvoke(connectorDispatchFn);
    connectorSyncNotionFn.grantInvoke(connectorDispatchFn);
    connectorSyncGithubFn.grantInvoke(connectorDispatchFn);

    // c) EventBridge — every 6 hours, invoke the dispatcher
    new events.Rule(this, "ConnectorSchedule", {
      ruleName: `${namePrefix}-connector-schedule`,
      schedule: events.Schedule.rate(cdk.Duration.hours(6)),
      targets: [new events_targets.LambdaFunction(connectorDispatchFn)],
    });

    new cdk.CfnOutput(this, "ConnectorSyncSheetsFnName", {
      value: connectorSyncSheetsFn.functionName,
    });
    new cdk.CfnOutput(this, "ConnectorSyncDocsFnName", {
      value: connectorSyncDocsFn.functionName,
    });
    new cdk.CfnOutput(this, "ConnectorSyncSlidesFnName", {
      value: connectorSyncSlidesFn.functionName,
    });
    new cdk.CfnOutput(this, "ConnectorSyncNotionFnName", {
      value: connectorSyncNotionFn.functionName,
    });
    new cdk.CfnOutput(this, "ConnectorSyncGithubFnName", {
      value: connectorSyncGithubFn.functionName,
    });

    // ── 7b. Multi-brain control plane ─────────────────────────────────
    //   Declared BEFORE the optional App Runner block so the App Runner
    //   instance role can grant cross-brain access. The default brain's
    //   token_secret_arn is resolved via cdk.Lazy because the secret
    //   itself is conditional on `-c token=<value>` being passed.
    const teamToken = this.node.tryGetContext("token") as string | undefined;
    const databaseDriver = this.node.tryGetContext("DATABASE_DRIVER") as
      | string
      | undefined;
    const databasePrepare = this.node.tryGetContext("DATABASE_PREPARE") as
      | string
      | undefined;
    const betterAuthSecret = this.node.tryGetContext("BETTER_AUTH_SECRET") as
      | string
      | undefined;
    const betterAuthUrl = this.node.tryGetContext("BETTER_AUTH_URL") as
      | string
      | undefined;
    const mcpTokenPepper = this.node.tryGetContext("MCP_TOKEN_PEPPER") as
      | string
      | undefined;
    const appMode = this.node.tryGetContext("APP_MODE") as string | undefined;
    const allowPublicSignup = this.node.tryGetContext(
      "ALLOW_PUBLIC_SIGNUP"
    ) as string | undefined;
    const billingEnabled = this.node.tryGetContext("BILLING_ENABLED") as
      | string
      | undefined;
    const appUrl = this.node.tryGetContext("APP_URL") as string | undefined;
    const marketingUrl = this.node.tryGetContext("MARKETING_URL") as
      | string
      | undefined;
    const mcpPublicHost = this.node.tryGetContext("MCP_PUBLIC_HOST") as
      | string
      | undefined;
    const sesRegion = this.node.tryGetContext("SES_REGION") as
      | string
      | undefined;
    const sesFromEmail = this.node.tryGetContext("SES_FROM_EMAIL") as
      | string
      | undefined;
    const sesReplyToEmail = this.node.tryGetContext("SES_REPLY_TO_EMAIL") as
      | string
      | undefined;
    let defaultBrainTokenSecret: secretsmanager.Secret | undefined;
    let mcpServiceUrl: string | undefined;
    const mcpEnvVars: Array<{ name: string; value: string }> = [];
    const openSaasEnvVars: Array<{ name: string; value: string }> = [
      ...(databaseUrl ? [{ name: "DATABASE_URL", value: databaseUrl }] : []),
      ...(databaseDriver
        ? [{ name: "DATABASE_DRIVER", value: databaseDriver }]
        : []),
      ...(databasePrepare
        ? [{ name: "DATABASE_PREPARE", value: databasePrepare }]
        : []),
      ...(betterAuthSecret
        ? [{ name: "BETTER_AUTH_SECRET", value: betterAuthSecret }]
        : []),
      ...(betterAuthUrl
        ? [{ name: "BETTER_AUTH_URL", value: betterAuthUrl }]
        : []),
      ...(mcpTokenPepper
        ? [{ name: "MCP_TOKEN_PEPPER", value: mcpTokenPepper }]
        : []),
      ...(appMode ? [{ name: "APP_MODE", value: appMode }] : []),
      ...(allowPublicSignup
        ? [{ name: "ALLOW_PUBLIC_SIGNUP", value: allowPublicSignup }]
        : []),
      ...(billingEnabled
        ? [{ name: "BILLING_ENABLED", value: billingEnabled }]
        : []),
      ...(appUrl ? [{ name: "APP_URL", value: appUrl }] : []),
      ...(marketingUrl ? [{ name: "MARKETING_URL", value: marketingUrl }] : []),
      ...(sesRegion ? [{ name: "SES_REGION", value: sesRegion }] : []),
      ...(sesFromEmail
        ? [{ name: "SES_FROM_EMAIL", value: sesFromEmail }]
        : []),
      ...(sesReplyToEmail
        ? [{ name: "SES_REPLY_TO_EMAIL", value: sesReplyToEmail }]
        : []),
    ];

    const brainShared = new BrainShared(this, "BrainShared", {
      namePrefix,
      embedModelArn,
      embedDim,
      vectorBucketName,
      vectorBucketArn,
      sharedKbRoleArn: kbRole.roleArn,
      autoIngestFn: ingestFn,
      pgHttpLayer,
      databaseUrl,
    });

    // Connector plane — sync Lambdas read/write the Postgres `connectors`
    // table (over HTTP via DATABASE_URL) and each brain's docs bucket. They
    // need wildcard S3 access to context101-brain-* buckets so a
    // newly-provisioned brain works without redeploying.
    const allSyncFns = [
      connectorSyncSheetsFn,
      connectorSyncDocsFn,
      connectorSyncSlidesFn,
      connectorSyncNotionFn,
      connectorSyncGithubFn,
    ];
    for (const fn of allSyncFns) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          sid: "RwBrainDocsBuckets",
          actions: [
            "s3:ListBucket",
            "s3:GetObject",
            "s3:PutObject",
            "s3:DeleteObject",
          ],
          resources: [
            `arn:aws:s3:::${namePrefix}-brain-*`,
            `arn:aws:s3:::${namePrefix}-brain-*/*`,
          ],
        })
      );
    }

    new cdk.CfnOutput(this, "BrainProvisionerFnName", {
      value: brainShared.provisionerFn.functionName,
      description:
        "Lambda invoked by /api/brains/{create,delete} to provision per-brain resources.",
    });

    // ── 8. Optional: App Runner service hosting the MCP server ────────
    //      Only provisioned if -c token=<value> is passed at deploy time.

    if (teamToken) {
      // a) Store the bearer token in Secrets Manager
      const tokenSecret = new secretsmanager.Secret(this, "TokenSecret", {
        secretName: `${namePrefix}-bearer-token`,
        description: "Shared bearer token for the Context101 MCP server",
        secretStringValue: cdk.SecretValue.unsafePlainText(teamToken),
      });
      defaultBrainTokenSecret = tokenSecret;

      // b) Build Docker image from the repo root (parent of cdk/)
      const image = new ecr_assets.DockerImageAsset(this, "McpImage", {
        directory: path.resolve(__dirname, "..", ".."),
        platform: ecr_assets.Platform.LINUX_AMD64,
        file: "Dockerfile",
      });

      // c) App Runner instance role — runtime perms (what the MCP can do).
      //   The MCP server resolves the active brain on each request from
      //   BrainsTable + the per-brain token secret, then reads/writes that
      //   brain's KB, bucket, and suggestions table. Permissions are
      //   wildcarded across context101-brain-* so newly-provisioned brains
      //   work without redeploying.
      const instanceRole = new iam.Role(this, "AppRunnerInstanceRole", {
        assumedBy: new iam.ServicePrincipal("tasks.apprunner.amazonaws.com"),
        description: "Runtime role for the Context101 MCP App Runner service",
      });
      // Bedrock Retrieve on any brain's KB. KB ARNs aren't known at synth
      // for runtime-provisioned brains; the role-level wildcard is the gate.
      instanceRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "RetrieveAnyBrainKb",
          actions: ["bedrock:Retrieve"],
          resources: [
            `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*`,
          ],
        })
      );
      // Default brain bucket + every future brain bucket.
      docsBucket.grantRead(instanceRole);
      instanceRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "ReadBrainBuckets",
          actions: ["s3:GetObject", "s3:ListBucket"],
          resources: [
            `arn:aws:s3:::${namePrefix}-brain-*`,
            `arn:aws:s3:::${namePrefix}-brain-*/*`,
          ],
        })
      );
      // The MCP server resolves the active brain from the Postgres `brains`
      // registry (over HTTP via DATABASE_URL). Bearer tokens validate
      // against Postgres `mcp_tokens`, with a Secrets Manager fallback —
      // default brain's token plus any future brain's token.
      tokenSecret.grantRead(instanceRole);
      instanceRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "ReadBrainTokenSecrets",
          actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
          resources: [
            `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${namePrefix}-brain-*`,
          ],
        })
      );

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
                // The MCP server resolves the active brain per-request from
                // the Postgres `brains` registry (DATABASE_URL in openSaas env).
                ...openSaasEnvVars,
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

      const mcpUrl = cdk.Fn.join("", [
        "https://",
        service.attrServiceUrl,
        "/mcp",
      ]);
      mcpServiceUrl = cdk.Fn.join("", ["https://", service.attrServiceUrl]);

      new cdk.CfnOutput(this, "McpUrl", {
        value: mcpUrl,
        description:
          "Share with the team. Requires Authorization: Bearer <token> header.",
      });

      // Expose to the Amplify build so /about can render a copy-pasteable
      // MCP client config without a hardcoded URL/token in source.
      mcpEnvVars.push(
        { name: "NEXT_PUBLIC_MCP_URL", value: mcpUrl },
        { name: "NEXT_PUBLIC_MCP_TOKEN", value: teamToken }
      );
    }

    // ── 9. Optional: Amplify Hosting for the web admin UI ─────────────
    //      Only provisioned if -c githubToken=<pat> is passed.
    const githubToken = this.node.tryGetContext("githubToken") as
      | string
      | undefined;

    if (githubToken) {
      // a) Service role for the Amplify app. Auth is Better Auth + Postgres
      //    now, so there's no Amplify Gen 2 backend (Cognito) to provision —
      //    this role exists only so Amplify Hosting can deliver SSR compute
      //    logs to CloudWatch. Without these perms, log groups never get
      //    created. See:
      //    https://github.com/aws-amplify/amplify-hosting/issues/3964
      const amplifyServiceRole = new iam.Role(this, "AmplifyServiceRole", {
        assumedBy: new iam.ServicePrincipal("amplify.amazonaws.com"),
        description: "Used by Amplify Hosting to deliver SSR compute logs",
      });
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
          // Brain control plane lives in Postgres (DATABASE_URL in the
          // OpenSaaS env below). BRAIN_PROVISIONER_FN_NAME is invoked from
          // /api/brains/{create,delete} (SSR has no permission to provision
          // AWS resources directly).
          { name: "BRAIN_PROVISIONER_FN_NAME", value: brainShared.provisionerFn.functionName },
          // MCP host (no /mcp suffix; the /about page appends /brain/<id>/mcp
          // per brain). Empty string when teamToken wasn't passed on this deploy.
          {
            name: "NEXT_PUBLIC_MCP_HOST",
            value: mcpPublicHost ?? mcpServiceUrl ?? "",
          },
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
          // Data source connectors
          { name: "CONNECTOR_SYNC_SHEETS_FN_NAME", value: connectorSyncSheetsFn.functionName },
          { name: "CONNECTOR_SYNC_DOCS_FN_NAME", value: connectorSyncDocsFn.functionName },
          { name: "CONNECTOR_SYNC_SLIDES_FN_NAME", value: connectorSyncSlidesFn.functionName },
          { name: "CONNECTOR_SYNC_NOTION_FN_NAME", value: connectorSyncNotionFn.functionName },
          { name: "CONNECTOR_SYNC_GITHUB_FN_NAME", value: connectorSyncGithubFn.functionName },
          { name: "GOOGLE_OAUTH_CLIENT_SECRET_ID", value: googleOAuthClientSecret.secretName },
          { name: "NOTION_OAUTH_CLIENT_SECRET_ID", value: notionOAuthClientSecret.secretName },
          { name: "CONNECTOR_TOKEN_SECRET_PREFIX", value: `${namePrefix}-connector-` },
          // Postgres + Better Auth env (DATABASE_URL, BETTER_AUTH_*, etc.).
          ...openSaasEnvVars,
          // MCP URL + bearer token for the /about page snippets. Empty
          // unless `-c token=` was also passed; the page falls back to
          // placeholder strings.
          ...mcpEnvVars,
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
      ssrComputeRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "SendTransactionalEmail",
          actions: ["ses:SendEmail"],
          resources: ["*"],
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
      // List Bedrock models for the Settings → Wiki model picker (the
      // searchable dropdown). List* actions don't support resource scoping.
      ssrComputeRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "ListBedrockModels",
          actions: ["bedrock:ListFoundationModels"],
          resources: ["*"],
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
      // Suggestions + connectors are R/W in Postgres (over HTTP via
      // DATABASE_URL), so SSR needs no DynamoDB grants for them.
      //
      // Data source connectors still need AWS for:
      //   - Read the OAuth client secret (to start/complete OAuth flows)
      //   - Create + delete per-connection token secrets (named
      //     `context101-connector-<uuid>`)
      //   - Invoke the per-type sync Lambda for "Sync now"
      googleOAuthClientSecret.grantRead(ssrComputeRole);
      notionOAuthClientSecret.grantRead(ssrComputeRole);
      ssrComputeRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "ManageConnectorTokenSecrets",
          actions: [
            "secretsmanager:CreateSecret",
            "secretsmanager:PutSecretValue",
            "secretsmanager:UpdateSecret",
            "secretsmanager:DeleteSecret",
            "secretsmanager:GetSecretValue",
            "secretsmanager:TagResource",
          ],
          resources: [
            `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${namePrefix}-connector-*`,
          ],
        })
      );
      // CreateSecret also requires the resource-less action to pass a
      // wildcard name check — AWS requires this for the Create call.
      ssrComputeRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "CreateConnectorTokenSecrets",
          actions: ["secretsmanager:CreateSecret"],
          resources: ["*"],
          conditions: {
            StringLike: {
              "secretsmanager:Name": `${namePrefix}-connector-*`,
            },
          },
        })
      );
      // Bring-your-own wiki model API keys (Settings → Wiki model). Stored as
      // `context101-brain-<id>-llm-key`; the SSR route writes/rotates/deletes
      // them and the wiki task reads them at generation time.
      ssrComputeRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "ManageBrainLlmKeySecrets",
          actions: [
            "secretsmanager:CreateSecret",
            "secretsmanager:PutSecretValue",
            "secretsmanager:UpdateSecret",
            "secretsmanager:DeleteSecret",
            "secretsmanager:DescribeSecret",
            "secretsmanager:GetSecretValue",
            "secretsmanager:TagResource",
          ],
          resources: [
            `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${namePrefix}-brain-*-llm-key*`,
          ],
        })
      );
      ssrComputeRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "CreateBrainLlmKeySecrets",
          actions: ["secretsmanager:CreateSecret"],
          resources: ["*"],
          conditions: {
            StringLike: {
              "secretsmanager:Name": `${namePrefix}-brain-*-llm-key`,
            },
          },
        })
      );
      connectorSyncSheetsFn.grantInvoke(ssrComputeRole);
      connectorSyncDocsFn.grantInvoke(ssrComputeRole);
      connectorSyncSlidesFn.grantInvoke(ssrComputeRole);
      connectorSyncNotionFn.grantInvoke(ssrComputeRole);
      connectorSyncGithubFn.grantInvoke(ssrComputeRole);
      // S3 delete under sources/sheets/ so DELETE /api/connectors/:id can
      // clean up. The role already has s3:GetObject/PutObject/List via
      // earlier grants; DeleteObject is the only gap.
      docsBucket.grantDelete(ssrComputeRole);
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
        layers: [pgHttpLayer],
        environment: {
          WIKI_CLUSTER_ARN: wikiCluster.clusterArn,
          WIKI_TASK_DEF_ARN: wikiTaskDef.taskDefinitionArn,
          WIKI_SUBNET_IDS: wikiVpc.publicSubnets.map((s) => s.subnetId).join(","),
          WIKI_SECURITY_GROUP_ID: wikiSg.securityGroupId,
          // Resolves brain_id → docs_bucket at RunTask time so the
          // generator reads from the right brain's bucket, from the
          // Postgres control plane (DATABASE_URL).
          ...pgLambdaEnv,
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
      // Single-flight dedup: before RunTask, the Lambda lists tasks in
      // the wiki cluster and inspects their WIKI_MODE / REPO_FULL_NAME
      // overrides to detect an in-flight regen. Same path is used by
      // the SSR /api/wiki/refresh GET ?check=1 to tell the frontend
      // "regen already running, attach instead of trigger".
      // ListTasks/DescribeTasks don't take resource ARNs; scope via the
      // ecs:cluster condition key.
      startWikiGenFn.addToRolePolicy(
        new iam.PolicyStatement({
          sid: "InspectWikiTasks",
          actions: ["ecs:ListTasks", "ecs:DescribeTasks"],
          resources: ["*"],
          conditions: {
            ArnEquals: { "ecs:cluster": wikiCluster.clusterArn },
          },
        })
      );

      // Multi-brain control plane:
      //   - The brain registry lives in Postgres (DATABASE_URL); SSR reads
      //     it over HTTP, so no DynamoDB grants are needed.
      //   - SSR invokes BrainProvisionerFn from /api/brains/{create,delete}.
      //   - SSR needs cross-brain S3 + Secrets Manager access for any brain
      //     provisioned at runtime.
      brainShared.provisionerFn.grantInvoke(ssrComputeRole);
      ssrComputeRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "RwBrainBuckets",
          actions: [
            "s3:ListBucket",
            "s3:GetObject",
            "s3:PutObject",
            "s3:DeleteObject",
          ],
          resources: [
            `arn:aws:s3:::${namePrefix}-brain-*`,
            `arn:aws:s3:::${namePrefix}-brain-*/*`,
          ],
        })
      );
      ssrComputeRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "ReadBrainTokenSecrets",
          actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
          resources: [
            `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${namePrefix}-brain-*`,
          ],
        })
      );
      // Bedrock Retrieve on any brain's KB (KB ARNs aren't known at synth
      // for runtime-provisioned brains).
      ssrComputeRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "RetrieveAnyBrainKb",
          actions: ["bedrock:Retrieve"],
          resources: [
            `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*`,
          ],
        })
      );

      // SSR can invoke the dispatcher + describe tasks for polling
      startWikiGenFn.grantInvoke(ssrComputeRole);
      // GitHub connector fires the per-repo code-wiki Fargate task after
      // each successful sync.
      startWikiGenFn.grantInvoke(connectorSyncGithubFn);
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
