import { S3Client } from "@aws-sdk/client-s3";

/**
 * Single S3 client for the Next.js runtime.
 *
 * Local dev: uses the standard AWS SDK credential chain — set
 *   AWS_PROFILE=plateapr.com in .env.local.
 *
 * Production (Amplify Hosting): the SSR compute Lambda's execution
 * role needs s3:ListBucket, s3:GetObject, s3:PutObject, s3:DeleteObject
 * on the docs bucket. We grant those via the CDK stack.
 */
export const s3 = new S3Client({
  region: process.env.AWS_REGION ?? "us-east-1",
});

export const DOCS_BUCKET = process.env.DOCS_BUCKET ?? "";

if (!DOCS_BUCKET) {
  // Logged once at module load; individual handlers still return 500
  // if they try to use an empty bucket name.
  console.warn("DOCS_BUCKET env var is not set — S3 routes will fail.");
}
