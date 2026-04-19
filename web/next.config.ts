import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Amplify Hosting's SSR runtime doesn't forward app-level env vars to the
  // compute Lambda by default. Bake DOCS_BUCKET into the build so
  // process.env.DOCS_BUCKET works at runtime.
  env: {
    DOCS_BUCKET: process.env.DOCS_BUCKET,
  },
  // NOTE: don't use serverExternalPackages with @aws-sdk — Turbopack
  // (the default builder in Next 16) suffixes externalized modules with
  // a hash (e.g. "@aws-sdk/client-s3-611b56be8ae898f4") and then can't
  // resolve them at runtime on Amplify Hosting. Let it bundle the SDK.
};

export default nextConfig;
