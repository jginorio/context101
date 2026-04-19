#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { TeamBrainStack } from "../lib/team-brain-stack";

const app = new cdk.App();

new TeamBrainStack(app, "TeamBrainStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
  description: "Team Brain — Bedrock Knowledge Base backed by S3 + S3 Vectors",
});
