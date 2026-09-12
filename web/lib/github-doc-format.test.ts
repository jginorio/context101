import assert from "node:assert/strict";
import { test } from "node:test";

import {
  invertGithubS3Body,
  renderCode,
  renderMarkdown,
} from "./github-doc-format";

const ctx = {
  path: "docs/auth.md",
  repoFullName: "acme/platform",
  htmlUrl: "https://github.com/acme/platform/blob/main/docs/auth.md",
  now: "2026-09-12T05:00:00.000Z",
};

test("invertGithubS3Body o renderMarkdown is identity for a sample file", () => {
  const original = [
    "Session cookies last 12 hours.",
    "",
    "Rotate the signing key on deploy.",
  ].join("\n");
  const rendered = renderMarkdown(original, ctx);
  assert.equal(invertGithubS3Body(rendered), original);
});

test("invertGithubS3Body is a no-op without a GitHub citation header", () => {
  const body = "# Manual note\n\nKeep this heading.";
  assert.equal(invertGithubS3Body(body), body);
});

test("renderCode matches the connector fenced shape", () => {
  const rendered = renderCode("export const x = 1;", {
    ...ctx,
    path: "src/x.ts",
    language: "typescript",
  });
  assert.match(rendered, /^# src\/x\.ts\n/);
  assert.match(rendered, /```typescript\nexport const x = 1;\n```\n$/);
});
