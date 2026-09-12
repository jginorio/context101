import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as cr from "aws-cdk-lib/custom-resources";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const DB_NAME = "context101";
const DB_USER = "context101";

export function contextWantsRds(scope: Construct): boolean {
  const flag = String(scope.node.tryGetContext("CREATE_RDS") ?? "").toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

export function composeRdsUrl(
  instance: rds.DatabaseInstance,
  secret: secretsmanager.ISecret
): string {
  return cdk.Fn.join("", [
    "postgresql://",
    secret.secretValueFromJson("username").unsafeUnwrap(),
    ":",
    secret.secretValueFromJson("password").unsafeUnwrap(),
    "@",
    instance.instanceEndpoint.hostname,
    ":5432/",
    DB_NAME,
    "?sslmode=require",
  ]);
}

/**
 * Small public Postgres for a found-the-repo self-host that has no
 * Neon/Supabase URL. Amplify SSR and the worker Lambdas stay outside
 * this VPC, so the instance is reachable on 5432 from the internet.
 * Credentials live in Secrets Manager; the password is never a stack
 * output.
 */
export function provisionRdsPostgres(
  scope: Construct,
  vpc: ec2.IVpc,
  namePrefix: string
): { instance: rds.DatabaseInstance; databaseUrl: string; secretArn: string } {
  const instance = new rds.DatabaseInstance(scope, "ControlPlaneDb", {
    engine: rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.VER_16,
    }),
    instanceType: ec2.InstanceType.of(
      ec2.InstanceClass.T3,
      ec2.InstanceSize.MICRO
    ),
    vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    publiclyAccessible: true,
    allocatedStorage: 20,
    storageType: rds.StorageType.GP3,
    multiAz: false,
    databaseName: DB_NAME,
    credentials: rds.Credentials.fromGeneratedSecret(DB_USER, {
      secretName: `${namePrefix}/control-plane/rds`,
      excludeCharacters: " %+~`#$&*()|[]{}:;<>?!'/@\"\\",
    }),
    backupRetention: cdk.Duration.days(7),
    deletionProtection: false,
    removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
    iamAuthentication: false,
  });
  instance.connections.allowFromAnyIpv4(
    ec2.Port.tcp(5432),
    "Self-host Amplify SSR + worker Lambdas (no Neon URL)"
  );

  const secret = instance.secret;
  if (!secret) {
    throw new Error("RDS instance did not create a generated secret");
  }
  const databaseUrl = composeRdsUrl(instance, secret);
  return { instance, databaseUrl, secretArn: secret.secretArn };
}

export function applyControlPlaneMigrations(
  scope: Construct,
  opts: {
    databaseUrl: string;
    pgHttpLayer: lambda.ILayerVersion;
    instance: rds.DatabaseInstance;
  }
): void {
  const migrateSrc = path.resolve(__dirname, "..", "lambda", "db-migrate");
  const drizzleDir = path.resolve(__dirname, "..", "..", "web", "drizzle");
  const journal = fs.readFileSync(
    path.join(drizzleDir, "meta", "_journal.json"),
    "utf8"
  );

  const migrateFn = new lambda.Function(scope, "DbMigrateFn", {
    runtime: lambda.Runtime.NODEJS_20_X,
    handler: "index.handler",
    code: lambda.Code.fromAsset(migrateSrc, {
      bundling: {
        image: lambda.Runtime.NODEJS_20_X.bundlingImage,
        environment: {
          HOME: "/tmp",
          npm_config_cache: "/tmp/.npm",
          npm_config_update_notifier: "false",
        },
        command: [
          "bash",
          "-c",
          "cp -au . /asset-output && mkdir -p /asset-output/drizzle && cp -a drizzle/. /asset-output/drizzle/",
        ],
        local: {
          tryBundle(outputDir: string): boolean {
            try {
              execSync(
                [
                  `cp -a "${migrateSrc}/." "${outputDir}/"`,
                  `mkdir -p "${outputDir}/drizzle"`,
                  `cp -a "${drizzleDir}/"*.sql "${outputDir}/drizzle/"`,
                  `cp -a "${drizzleDir}/meta/_journal.json" "${outputDir}/drizzle/_journal.json"`,
                ].join(" && "),
                { stdio: "inherit" }
              );
              return true;
            } catch {
              return false;
            }
          },
        },
      },
    }),
    timeout: cdk.Duration.minutes(5),
    memorySize: 256,
    layers: [opts.pgHttpLayer],
    environment: { DATABASE_URL: opts.databaseUrl },
    description: "Applies web/drizzle SQL to a CDK-created RDS control plane",
  });
  migrateFn.node.addDependency(opts.instance);

  const provider = new cr.Provider(scope, "DbMigrateProvider", {
    onEventHandler: migrateFn,
  });
  const resource = new cdk.CustomResource(scope, "DbSchema", {
    serviceToken: provider.serviceToken,
    properties: { Journal: journal },
  });
  resource.node.addDependency(opts.instance);
}
