import { S3Client } from "@aws-sdk/client-s3";

/**
 * Single S3 client for the Next.js runtime.
 *
 * Local dev: uses the standard AWS SDK credential chain — set
 *   AWS_PROFILE=plateapr.com in .env.local.
 *
 * Amplify Hosting: Amplify's SSR compute Lambda is managed internally
 * and we can't attach IAM policies to its role. Instead, we provision
 * a scoped IAM user (context101-web-ssr) and pass its access keys as
 * env vars (prefixed CONTEXT101_ so they don't collide with the
 * reserved "AWS_" prefix Amplify blocks).
 */

const hasScopedCreds =
  !!process.env.CONTEXT101_AWS_ACCESS_KEY_ID &&
  !!process.env.CONTEXT101_AWS_SECRET_ACCESS_KEY;

export const s3 = new S3Client({
  region: process.env.AWS_REGION ?? "us-east-1",
  ...(hasScopedCreds
    ? {
        credentials: {
          accessKeyId: process.env.CONTEXT101_AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.CONTEXT101_AWS_SECRET_ACCESS_KEY!,
        },
      }
    : {}),
});

export const DOCS_BUCKET = process.env.DOCS_BUCKET ?? "";

if (!DOCS_BUCKET) {
  console.warn("DOCS_BUCKET env var is not set — S3 routes will fail.");
}
