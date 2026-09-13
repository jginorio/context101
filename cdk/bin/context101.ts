#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { Context101Stack } from "../lib/context101-stack";
import { assertGatedContext, cdkCommandFromArgv } from "../lib/deploy-gate";

const app = new cdk.App();

assertGatedContext({
  command: cdkCommandFromArgv(process.argv),
  token: app.node.tryGetContext("token") as string | undefined,
  githubToken: app.node.tryGetContext("githubToken") as string | undefined,
  repository: app.node.tryGetContext("REPOSITORY") as string | undefined,
});

const stackName =
  String(app.node.tryGetContext("STACK_NAME") || "Context101Stack").trim() ||
  "Context101Stack";

new Context101Stack(app, stackName, {
  stackName,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "[REDACTED]",
  },
  description:
    "Context101 — shared team knowledge base (Bedrock KB + S3 + S3 Vectors + App Runner MCP)",
});
