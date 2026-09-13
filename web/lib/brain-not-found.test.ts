import assert from "node:assert/strict";
import { test } from "node:test";

import { brainNotFoundCopy, isEmptyStackNotFound } from "./brain-not-found";

test("empty catalog is the empty-stack case, not a stale default id", () => {
  const opts = {
    loading: false,
    error: null,
    brainsCount: 0,
    currentBrainId: "default",
  };
  assert.equal(isEmptyStackNotFound(opts), true);
  const copy = brainNotFoundCopy(opts);
  assert.equal(copy.kind, "empty-stack");
  assert.equal(copy.title, "No brains yet");
  assert.equal(copy.ctaLabel, "Create a brain");
  assert.equal(copy.href, "/brains?new=1");
  assert.equal(copy.ctaVariant, "default");
  assert.equal(copy.body.includes("registered under default"), false);
  assert.equal(copy.body.includes("stale"), false);
});

test("catalog with other brains and a missing id keeps the stale-link copy", () => {
  const opts = {
    loading: false,
    error: null,
    brainsCount: 2,
    currentBrainId: "default",
  };
  assert.equal(isEmptyStackNotFound(opts), false);
  const copy = brainNotFoundCopy(opts);
  assert.equal(copy.kind, "stale-link");
  assert.equal(copy.title, "Brain not found");
  assert.equal(copy.ctaLabel, "Pick another brain");
  assert.equal(copy.href, "/brains");
  assert.equal(copy.ctaVariant, "outline");
  assert.equal(copy.body.includes("registered under default"), true);
  assert.match(copy.body, /deleted|stale/);
});

test("catalog still loading is not treated as an empty stack", () => {
  const copy = brainNotFoundCopy({
    loading: true,
    error: null,
    brainsCount: 0,
    currentBrainId: "default",
  });
  assert.equal(copy.kind, "stale-link");
});

test("catalog list error is not treated as an empty stack", () => {
  const copy = brainNotFoundCopy({
    loading: false,
    error: "brains/list failed: 500",
    brainsCount: 0,
    currentBrainId: "default",
  });
  assert.equal(copy.kind, "stale-link");
  assert.equal(copy.ctaLabel, "Pick another brain");
});
