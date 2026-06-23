import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(siteRoot, "..");

const nextConfig: NextConfig = {
  transpilePackages: ["@context101/ui"],
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;
