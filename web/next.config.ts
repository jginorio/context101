import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Amplify Hosting's SSR runtime doesn't forward app-level env vars to the
  // compute Lambda by default. Bake DOCS_BUCKET into the build so
  // process.env.DOCS_BUCKET works at runtime.
  env: {
    DOCS_BUCKET: process.env.DOCS_BUCKET,
    SUGGESTIONS_TABLE: process.env.SUGGESTIONS_TABLE,
    WIKI_CLUSTER_ARN: process.env.WIKI_CLUSTER_ARN,
    WIKI_TASK_DEF_ARN: process.env.WIKI_TASK_DEF_ARN,
    WIKI_SUBNET_IDS: process.env.WIKI_SUBNET_IDS,
    WIKI_SECURITY_GROUP_ID: process.env.WIKI_SECURITY_GROUP_ID,
    START_WIKI_GEN_FN_NAME: process.env.START_WIKI_GEN_FN_NAME,
  },
  // Force Turbopack to BUNDLE @aws-sdk instead of externalizing it.
  // Next 16's Turbopack auto-externalizes @aws-sdk/* by default, but it
  // renames them with a hash ("@aws-sdk/client-s3-611b56...") that
  // Amplify's Lambda runtime can't resolve. Bundling side-steps the issue.
  transpilePackages: [
    "@aws-sdk/client-s3",
    "@aws-sdk/client-dynamodb",
    "@aws-sdk/lib-dynamodb",
  ],
};

export default nextConfig;
