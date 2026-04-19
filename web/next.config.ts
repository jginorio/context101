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
  // AWS SDK v3 uses dynamic/conditional requires that the Next.js bundler
  // can't resolve cleanly; marking them external tells Next to leave them
  // as runtime `require()` calls. (Do NOT externalize aws-amplify — it
  // isn't shipped in Amplify's SSR runtime image, it has to be bundled.)
  serverExternalPackages: ["@aws-sdk/client-s3"],
};

export default nextConfig;
