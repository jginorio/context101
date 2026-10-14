import assert from "node:assert/strict";
import { test } from "node:test";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Context101Stack } from "../lib/context101-stack";

type CfnEnvVar = { Name?: string; Value?: unknown };

function amplifyEnv(template: Template): CfnEnvVar[] {
  const apps = template.findResources("AWS::Amplify::App");
  const app = Object.values(apps)[0];
  assert.ok(app, "expected AWS::Amplify::App");
  const env = app.Properties?.EnvironmentVariables;
  assert.ok(Array.isArray(env), "expected Amplify environmentVariables");
  return env as CfnEnvVar[];
}

function envValue(env: CfnEnvVar[], name: string): unknown {
  const row = env.find((item) => item.Name === name);
  assert.ok(row, `expected Amplify env ${name}`);
  return row.Value;
}

function isCfnRef(value: unknown): boolean {
  if (value == null || typeof value !== "object") return false;
  const keys = Object.keys(value as object);
  return keys.includes("Ref") || keys.includes("Fn::GetAtt") || keys.includes("Fn::Join");
}

function synthCodeCommitStack() {
  const app = new cdk.App({
    context: {
      token: "ctx_testtoken_xx",
      DATABASE_URL:
        "postgresql://context101:test@127.0.0.1:5432/context101?sslmode=require",
      NAME_PREFIX: "context101-testingcontext101",
      // Skip Docker / npm asset builds — cycle detection is in the
      // construct graph, not the image bytes.
      "aws:cdk:bundling-stacks": [],
    },
  });
  const stack = new Context101Stack(app, "Context101Testingcontext101", {
    env: { account: "123456789012", region: "us-west-2" },
  });
  // Template.fromStack synthesizes and throws on a circular dependency.
  const template = Template.fromStack(stack);
  return { app, stack, template };
}

test("full stack synths CodeCommit admin with Amplify and no circular dependency", () => {
  const { template } = synthCodeCommitStack();

  template.resourceCountIs("AWS::Amplify::App", 1);
  template.resourceCountIs("AWS::Amplify::Branch", 1);
  template.resourceCountIs("AWS::CodeCommit::Repository", 1);
  template.hasResourceProperties("AWS::Amplify::App", {
    Platform: "WEB_COMPUTE",
    Name: "context101-testingcontext101-web",
  });
  template.hasResourceProperties("AWS::CodeCommit::Repository", {
    RepositoryName: "context101-testingcontext101-admin",
  });

  const apps = template.findResources("AWS::Amplify::App");
  const props = Object.values(apps)[0]?.Properties ?? {};
  assert.equal(Object.prototype.hasOwnProperty.call(props, "AccessToken"), false);
  template.hasResourceProperties(
    "AWS::Amplify::App",
    Match.objectLike({
      AccessToken: Match.absent(),
      ComputeRoleArn: Match.anyValue(),
    })
  );

  const env = amplifyEnv(template);
  assert.equal(
    env.some((item) => item.Name === "NEXT_PUBLIC_MCP_URL"),
    false,
    "NEXT_PUBLIC_MCP_URL must not be forwarded after /about was removed"
  );
  assert.equal(
    env.some((item) => item.Name === "NEXT_PUBLIC_MCP_TOKEN"),
    false,
    "NEXT_PUBLIC_MCP_TOKEN must not be forwarded after /about was removed"
  );
  const knownFns: Record<string, string> = {
    BRAIN_PROVISIONER_FN_NAME: "context101-testingcontext101-brain-provisioner",
    START_WIKI_GEN_FN_NAME: "context101-testingcontext101-start-wiki-gen",
    CONNECTOR_SYNC_SHEETS_FN_NAME:
      "context101-testingcontext101-connector-sync-sheets",
    CONNECTOR_SYNC_DOCS_FN_NAME: "context101-testingcontext101-connector-sync-docs",
    CONNECTOR_SYNC_SLIDES_FN_NAME:
      "context101-testingcontext101-connector-sync-slides",
    CONNECTOR_SYNC_NOTION_FN_NAME:
      "context101-testingcontext101-connector-sync-notion",
    CONNECTOR_SYNC_GITHUB_FN_NAME:
      "context101-testingcontext101-connector-sync-github",
  };
  for (const [name, expected] of Object.entries(knownFns)) {
    const value = envValue(env, name);
    assert.equal(
      isCfnRef(value),
      false,
      `${name} must be a known name, not a CfnRef`
    );
    assert.equal(value, expected);
  }

  const policies = template.findResources("AWS::IAM::Policy");
  const ssrPolicy = Object.entries(policies).find(([id]) =>
    id.startsWith("WebSsrComputeRoleDefaultPolicy")
  );
  assert.ok(ssrPolicy, "expected WebSsrComputeRoleDefaultPolicy");
  const doc = JSON.stringify(ssrPolicy[1]?.Properties?.PolicyDocument ?? {});
  assert.match(
    doc,
    /arn:aws:lambda:us-west-2:123456789012:function:context101-testingcontext101-brain-provisioner/
  );
  assert.match(
    doc,
    /arn:aws:lambda:us-west-2:123456789012:function:context101-testingcontext101-start-wiki-gen/
  );
  assert.equal(
    doc.includes("{\"Ref\":") &&
      /BrainProvisionerFn|AutoIngestFn/.test(doc),
    false,
    "SSR DefaultPolicy must not Ref BrainProvisionerFn / AutoIngestFn"
  );

  const lambdas = template.findResources("AWS::Lambda::Function");
  const allLambdaEnv = JSON.stringify(
    Object.values(lambdas).map((fn) => fn.Properties?.Environment ?? {})
  );
  assert.equal(
    allLambdaEnv.includes("CONFLICT_EVIDENCE"),
    false,
    "no Lambda may set CONFLICT_EVIDENCE_URL / SECRET"
  );

  const githubSync = Object.values(lambdas).find((fn) =>
    String(fn.Properties?.FunctionName ?? "").endsWith("-connector-sync-github")
  );
  assert.ok(githubSync, "expected connector-sync-github Lambda");
  const githubEnv = githubSync.Properties?.Environment?.Variables ?? {};
  assert.equal(githubEnv.AUTO_TRIGGER_CODE_WIKI, "false");

  const rules = template.findResources("AWS::Events::Rule");
  const wikiSchedule = Object.values(rules).find((rule) =>
    String(rule.Properties?.Description ?? "").includes("wiki")
  );
  assert.ok(wikiSchedule, "expected WikiGenSchedule rule");
  assert.equal(wikiSchedule.Properties?.State, "DISABLED");
});

test("hosted APP_MODE keeps context101.dev public URLs on Amplify", () => {
  const zone = ["context", "101", ".", "dev"].join("");
  const appUrl = `https://app.${zone}`;
  const mcp = `https://mcp.${zone}`;
  const app = new cdk.App({
    context: {
      token: "ctx_testtoken_xx",
      DATABASE_URL:
        "postgresql://context101:test@127.0.0.1:5432/context101?sslmode=require",
      NAME_PREFIX: "context101-hosted",
      APP_MODE: "hosted",
      APP_URL: appUrl,
      BETTER_AUTH_URL: appUrl,
      MARKETING_URL: `https://${zone}`,
      MCP_PUBLIC_HOST: mcp,
      ALLOW_PUBLIC_SIGNUP: "false",
      BILLING_ENABLED: "false",
      "aws:cdk:bundling-stacks": [],
    },
  });
  const stack = new Context101Stack(app, "Context101Hosted", {
    env: { account: "123456789012", region: "us-west-2" },
  });
  const template = Template.fromStack(stack);
  const env = amplifyEnv(template);
  assert.equal(envValue(env, "APP_MODE"), "hosted");
  assert.equal(envValue(env, "APP_URL"), appUrl);
  assert.equal(envValue(env, "BETTER_AUTH_URL"), appUrl);
  assert.equal(
    env.some((item) => item.Name === "MARKETING_URL"),
    false,
    "MARKETING_URL must not be forwarded after site/ was removed"
  );
  assert.equal(envValue(env, "ALLOW_PUBLIC_SIGNUP"), "false");
  assert.equal(
    env.some((item) => item.Name === "BILLING_ENABLED"),
    false,
    "BILLING_ENABLED must not be forwarded — nothing reads billingEnabled"
  );
  const mcpHost = envValue(env, "NEXT_PUBLIC_MCP_HOST");
  assert.equal(mcpHost, mcp);
  assert.equal(
    env.some((item) => item.Name === "NEXT_PUBLIC_MCP_URL"),
    false,
    "NEXT_PUBLIC_MCP_URL must not be forwarded after /about was removed"
  );
  assert.equal(
    env.some((item) => item.Name === "NEXT_PUBLIC_MCP_TOKEN"),
    false,
    "NEXT_PUBLIC_MCP_TOKEN must not be forwarded after /about was removed"
  );
});
