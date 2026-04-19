import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Amplify Hosting's SSR runtime doesn't forward app-level env vars to the
  // compute Lambda by default. Listing them here bakes the values into the
  // build so process.env.X works at runtime.
  env: {
    DOCS_BUCKET: process.env.DOCS_BUCKET,
    CONTEXT101_AWS_ACCESS_KEY_ID: process.env.CONTEXT101_AWS_ACCESS_KEY_ID,
    CONTEXT101_AWS_SECRET_ACCESS_KEY: process.env.CONTEXT101_AWS_SECRET_ACCESS_KEY,
  },
  // AWS SDK v3 uses dynamic/conditional requires that Next.js's bundler
  // (Turbopack/webpack) can't resolve cleanly. Marking them "external"
  // tells Next to leave them as runtime `require()` calls.
  serverExternalPackages: [
    "@aws-sdk/client-s3",
    "@aws-sdk/credential-providers",
    "aws-amplify",
    "@aws-amplify/adapter-nextjs",
  ],
};

export default nextConfig;
