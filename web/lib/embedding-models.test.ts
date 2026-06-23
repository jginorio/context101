import assert from "node:assert/strict";
import { test } from "node:test";

import {
  embeddingModelArn,
  inferEmbeddingProvider,
  knownDimensionsFor,
  normalizeChunkingConfig,
  resolveEmbeddingSelection,
} from "./embedding-models";

const REGION = "us-east-1";

test("infers provider from model id prefix", () => {
  assert.equal(inferEmbeddingProvider("amazon.titan-embed-text-v2:0"), "aws");
  assert.equal(inferEmbeddingProvider("cohere.embed-v4:0"), "cohere");
  assert.equal(inferEmbeddingProvider("mistral.whatever"), null);
});

test("builds a region-scoped foundation-model ARN", () => {
  assert.equal(
    embeddingModelArn("cohere.embed-v4:0", REGION),
    "arn:aws:bedrock:us-east-1::foundation-model/cohere.embed-v4:0"
  );
});

test("known-dimension lookup falls back to 1024 for unknown models", () => {
  assert.deepEqual(knownDimensionsFor("amazon.titan-embed-text-v2:0"), {
    supportedDimensions: [256, 512, 1024],
    defaultDimension: 1024,
  });
  assert.deepEqual(knownDimensionsFor("some.future-embed-model"), {
    supportedDimensions: [1024],
    defaultDimension: 1024,
  });
});

test("resolves a valid AWS selection with default dimensions", () => {
  const res = resolveEmbeddingSelection(
    { provider: "aws", modelId: "amazon.titan-embed-text-v2:0" },
    REGION
  );
  assert.ok(res.ok);
  if (res.ok) {
    assert.equal(res.selection.dimensions, 1024);
    assert.equal(res.selection.chunking.strategy, "default");
  }
});

test("accepts a supported non-default dimension for Titan v2", () => {
  const res = resolveEmbeddingSelection(
    { provider: "aws", modelId: "amazon.titan-embed-text-v2:0", dimensions: 512 },
    REGION
  );
  assert.ok(res.ok);
  if (res.ok) assert.equal(res.selection.dimensions, 512);
});

test("rejects an unsupported dimension for a known model", () => {
  const res = resolveEmbeddingSelection(
    { provider: "aws", modelId: "amazon.titan-embed-text-v2:0", dimensions: 999 },
    REGION
  );
  assert.equal(res.ok, false);
});

test("rejects an unknown model id (e.g. a Bedrock per-SKU variant)", () => {
  // Variant/SKU ids like `cohere.embed-multilingual-v3:0:512` are not valid
  // KB embedding model ARNs and must be rejected.
  const res = resolveEmbeddingSelection(
    { provider: "cohere", modelId: "cohere.embed-multilingual-v3:0:512" },
    REGION
  );
  assert.equal(res.ok, false);
});

test("accepts the curated Cohere Embed v4 base id", () => {
  const res = resolveEmbeddingSelection(
    { provider: "cohere", modelId: "cohere.embed-v4:0" },
    REGION
  );
  assert.ok(res.ok);
  if (res.ok) assert.equal(res.selection.dimensions, 1024);
});

test("rejects a model id that doesn't match the provider", () => {
  const res = resolveEmbeddingSelection(
    { provider: "aws", modelId: "cohere.embed-english-v3" },
    REGION
  );
  assert.equal(res.ok, false);
});

test("rejects an unknown provider", () => {
  const res = resolveEmbeddingSelection(
    { provider: "openai", modelId: "amazon.titan-embed-text-v2:0" },
    REGION
  );
  assert.equal(res.ok, false);
});

test("requires a model id", () => {
  const res = resolveEmbeddingSelection({ provider: "aws" }, REGION);
  assert.equal(res.ok, false);
});

test("chunking is coerced to default for non-Cohere providers", () => {
  const res = normalizeChunkingConfig("aws", {
    strategy: "fixed",
    maxTokens: 200,
  });
  assert.ok(res.ok);
  if (res.ok) assert.equal(res.config.strategy, "default");
});

test("validates a Cohere fixed-size chunking config", () => {
  const res = normalizeChunkingConfig("cohere", {
    strategy: "fixed",
    maxTokens: 256,
    overlapPercentage: 15,
  });
  assert.ok(res.ok);
  if (res.ok) {
    assert.equal(res.config.strategy, "fixed");
    assert.equal(res.config.maxTokens, 256);
    assert.equal(res.config.overlapPercentage, 15);
  }
});

test("rejects an out-of-range overlap percentage", () => {
  const res = normalizeChunkingConfig("cohere", {
    strategy: "fixed",
    overlapPercentage: 150,
  });
  assert.equal(res.ok, false);
});

test("rejects hierarchical config where child >= parent", () => {
  const res = normalizeChunkingConfig("cohere", {
    strategy: "hierarchical",
    parentMaxTokens: 300,
    childMaxTokens: 300,
  });
  assert.equal(res.ok, false);
});

test("resolves a Cohere selection carrying its chunking config", () => {
  const res = resolveEmbeddingSelection(
    {
      provider: "cohere",
      modelId: "cohere.embed-multilingual-v3",
      chunkingConfig: { strategy: "semantic" },
    },
    REGION
  );
  assert.ok(res.ok);
  if (res.ok) {
    assert.equal(res.selection.dimensions, 1024);
    assert.equal(res.selection.chunking.strategy, "semantic");
    assert.equal(res.selection.chunking.breakpointPercentileThreshold, 95);
  }
});
