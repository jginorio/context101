import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { CDK_OUT_EXCLUDE } from "../lib/asset-exclude";

test("asset exclude covers cdk.out at any depth", () => {
  assert.deepEqual(CDK_OUT_EXCLUDE, ["cdk.out", "**/cdk.out"]);
});

test("repo-root Docker assets apply the cdk.out exclude", async () => {
  const src = await readFile(path.resolve(__dirname, "../lib/context101-stack.ts"), "utf8");
  assert.match(src, /CDK_OUT_EXCLUDE/);
  assert.match(src, /fromImageAsset\(/);
  assert.match(src, /new ecr_assets\.DockerImageAsset\(this, "McpImage"/);
});
