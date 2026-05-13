import { S3Client } from "@aws-sdk/client-s3";
import type { BrainConfig } from "@/lib/brains-server";

/**
 * S3 client for the Next.js runtime.
 *
 * Local dev: uses the standard AWS SDK credential chain — set
 *   AWS_PROFILE=<your-profile> in .env.local.
 *
 * Amplify Hosting: the SSR compute Lambda runs under a ComputeRoleArn
 * (wired up in CDK). Its role gives us s3:* on every brain's docs
 * bucket. The AWS SDK picks up those role creds automatically from the
 * Lambda env.
 *
 * Brain-aware shape:
 *   - `s3` (shared client) + `bucketForBrain(brain)` is the common pattern
 *      for routes that take a resolved BrainConfig.
 *   - `DOCS_BUCKET` is the *default brain's* bucket name as injected at
 *      build time. Kept as a fallback for unmigrated routes during the
 *      multi-brain migration; remove once everything reads from a brain.
 */
export const s3 = new S3Client({
  region: process.env.AWS_REGION ?? "us-east-1",
});

export const DOCS_BUCKET = process.env.DOCS_BUCKET ?? "";

if (!DOCS_BUCKET) {
  console.warn(
    "DOCS_BUCKET env var is not set — unmigrated S3 routes will fail."
  );
}

/** Pull the docs bucket name out of a resolved brain row. */
export function bucketForBrain(brain: BrainConfig): string {
  const b = brain.docs_bucket;
  if (!b) {
    throw new Error(
      `brain \`${brain.brain_id}\` has no docs_bucket on its registry row`
    );
  }
  return b;
}
