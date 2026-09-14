import type { NextConfig } from "next";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(appRoot, "..");

// npm workspaces hoist @better-auth/drizzle-adapter to the repo root but nest
// drizzle-orm under web/. turbopack.root is the repo, so the adapter's
// `import … from "drizzle-orm"` otherwise 500s /login.
function resolveFromWorkspace(name: string): string {
  const nested = path.join(appRoot, "node_modules", name);
  if (existsSync(nested)) return nested;
  const hoisted = path.join(repoRoot, "node_modules", name);
  if (existsSync(hoisted)) return hoisted;
  return name;
}

const drizzleOrm = resolveFromWorkspace("drizzle-orm");

const nextConfig: NextConfig = {
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
    resolveAlias: {
      "drizzle-orm": drizzleOrm,
    },
  },
  webpack: (config) => {
    config.resolve ??= {};
    const alias = config.resolve.alias;
    config.resolve.alias = {
      ...(alias && typeof alias === "object" && !Array.isArray(alias) ? alias : {}),
      "drizzle-orm": drizzleOrm,
    };
    return config;
  },
  // Amplify Hosting's SSR runtime doesn't forward app-level env vars to the
  // compute Lambda by default. Bake DOCS_BUCKET into the build so
  // process.env.DOCS_BUCKET works at runtime.
  env: {
    DOCS_BUCKET: process.env.DOCS_BUCKET,
    WIKI_CLUSTER_ARN: process.env.WIKI_CLUSTER_ARN,
    WIKI_TASK_DEF_ARN: process.env.WIKI_TASK_DEF_ARN,
    WIKI_SUBNET_IDS: process.env.WIKI_SUBNET_IDS,
    WIKI_SECURITY_GROUP_ID: process.env.WIKI_SECURITY_GROUP_ID,
    START_WIKI_GEN_FN_NAME: process.env.START_WIKI_GEN_FN_NAME,
    CONNECTOR_SYNC_SHEETS_FN_NAME: process.env.CONNECTOR_SYNC_SHEETS_FN_NAME,
    CONNECTOR_SYNC_DOCS_FN_NAME: process.env.CONNECTOR_SYNC_DOCS_FN_NAME,
    CONNECTOR_SYNC_SLIDES_FN_NAME: process.env.CONNECTOR_SYNC_SLIDES_FN_NAME,
    CONNECTOR_SYNC_NOTION_FN_NAME: process.env.CONNECTOR_SYNC_NOTION_FN_NAME,
    CONNECTOR_SYNC_GITHUB_FN_NAME: process.env.CONNECTOR_SYNC_GITHUB_FN_NAME,
    NOTION_OAUTH_CLIENT_SECRET_ID: process.env.NOTION_OAUTH_CLIENT_SECRET_ID,
    GOOGLE_OAUTH_CLIENT_SECRET_ID: process.env.GOOGLE_OAUTH_CLIENT_SECRET_ID,
    CONNECTOR_TOKEN_SECRET_PREFIX: process.env.CONNECTOR_TOKEN_SECRET_PREFIX,
    BRAIN_PROVISIONER_FN_NAME: process.env.BRAIN_PROVISIONER_FN_NAME,
  },
  // Force Turbopack to BUNDLE @aws-sdk instead of externalizing it.
  // Next 16's Turbopack auto-externalizes @aws-sdk/* by default, but it
  // renames them with a hash ("@aws-sdk/client-s3-611b56...") that
  // Amplify's Lambda runtime can't resolve. Bundling side-steps the issue.
  transpilePackages: [
    "@context101/ui",
    "@aws-sdk/client-s3",
    "@aws-sdk/client-bedrock",
    "@better-auth/drizzle-adapter",
    "drizzle-orm",
  ],
};

export default nextConfig;
