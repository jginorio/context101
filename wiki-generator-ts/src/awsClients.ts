/**
 * Shared AWS SDK v3 clients. Mirrors the boto3 client setup in generate.py:
 * adaptive retries with max 5 attempts. AWS_PROFILE, if set, is honored
 * automatically by the SDK's default credential provider chain — no explicit
 * wiring needed (unlike boto3, which takes profile_name explicitly).
 */

import { S3Client } from "@aws-sdk/client-s3";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { AWS_REGION } from "./config.js";

const shared = {
  region: AWS_REGION,
  maxAttempts: 5,
  retryMode: "adaptive" as const,
};

export const s3 = new S3Client(shared);
export const bedrock = new BedrockRuntimeClient(shared);
export const secrets = new SecretsManagerClient(shared);
