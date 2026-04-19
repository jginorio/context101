import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Amplify Hosting's SSR runtime doesn't forward app-level env vars to the
  // compute Lambda by default. Bake DOCS_BUCKET into the build so
  // process.env.DOCS_BUCKET works at runtime.
  env: {
    DOCS_BUCKET: process.env.DOCS_BUCKET,
  },
  // AWS SDK v3 uses dynamic/conditional requires that Next's bundler
  // can't resolve cleanly. External = leave as a runtime require().
  serverExternalPackages: ["@aws-sdk/client-s3"],
};

export default nextConfig;
