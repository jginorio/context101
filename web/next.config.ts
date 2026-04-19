import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Amplify Hosting's SSR runtime doesn't forward app-level env vars to the
  // compute Lambda by default. Bake DOCS_BUCKET into the build so
  // process.env.DOCS_BUCKET works at runtime.
  env: {
    DOCS_BUCKET: process.env.DOCS_BUCKET,
  },
  // Force Turbopack to BUNDLE @aws-sdk instead of externalizing it.
  // Next 16's Turbopack auto-externalizes @aws-sdk/* by default, but it
  // renames them with a hash ("@aws-sdk/client-s3-611b56...") that
  // Amplify's Lambda runtime can't resolve. Bundling side-steps the issue.
  transpilePackages: ["@aws-sdk/client-s3"],
};

export default nextConfig;
