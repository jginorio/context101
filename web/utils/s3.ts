import { S3Client } from "@aws-sdk/client-s3";

/**
 * Single S3 client for the Next.js runtime.
 *
 * Local dev: uses the standard AWS SDK credential chain — set
 *   AWS_PROFILE=<your-profile> in .env.local.
 *
 * Amplify Hosting: the SSR compute Lambda runs under a ComputeRoleArn
 * (wired up in CDK). Its role gives us s3:* on the docs bucket + CW logs.
 * The AWS SDK picks up those role creds automatically from the Lambda env.
 */
export const s3 = new S3Client({
  region: process.env.AWS_REGION ?? "us-east-1",
});

export const DOCS_BUCKET = process.env.DOCS_BUCKET ?? "";

if (!DOCS_BUCKET) {
  console.warn("DOCS_BUCKET env var is not set — S3 routes will fail.");
}
