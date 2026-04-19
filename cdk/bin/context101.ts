#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { Context101Stack } from "../lib/context101-stack";

const app = new cdk.App();

new Context101Stack(app, "Context101Stack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
  description:
    "Context101 — shared team knowledge base (Bedrock KB + S3 + S3 Vectors + App Runner MCP)",
});
