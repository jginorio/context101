import assert from "node:assert/strict";
import { test } from "node:test";

import {
  brainNotFoundCopy,
  brainSwitcherCopy,
  isEmptyStackNotFound,
} from "./brain-not-found";

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
  assert.equal(copy.body.toLowerCase().includes("wiki"), false);
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

test("empty-stack header does not present default (or any id) as active", () => {
  const copy = brainSwitcherCopy({
    loading: false,
    error: null,
    brainsCount: 0,
    currentBrainId: "default",
  });
  assert.equal(copy.kind, "empty-stack");
  assert.equal(copy.hint, "No brains yet");
  assert.equal(copy.label, "Create a brain");
  assert.equal(copy.ariaLabel, "No brains yet. Create a brain");
  assert.equal(copy.label.includes("default"), false);
  assert.equal(copy.hint.includes("default"), false);
  assert.equal(copy.ariaLabel.includes("default"), false);
  assert.equal(copy.ariaLabel.includes("Active brain"), false);
});

test("empty-stack header is the same with a null selected id", () => {
  const copy = brainSwitcherCopy({
    loading: false,
    error: null,
    brainsCount: 0,
    currentBrainId: null,
  });
  assert.equal(copy.kind, "empty-stack");
  assert.equal(copy.label, "Create a brain");
  assert.equal(copy.hint, "No brains yet");
});

test("loading header does not flash a leftover default id", () => {
  const copy = brainSwitcherCopy({
    loading: true,
    error: null,
    brainsCount: 0,
    currentBrainId: "default",
  });
  assert.equal(copy.kind, "loading");
  assert.equal(copy.hint, "Loading brains…");
  assert.equal(copy.label, "—");
  assert.equal(copy.label.includes("default"), false);
  assert.equal(copy.ariaLabel.includes("default"), false);
  assert.equal(copy.ariaLabel.includes("Active brain"), false);
});

test("ready brain keeps the display name as the active label", () => {
  const copy = brainSwitcherCopy({
    loading: false,
    error: null,
    brainsCount: 1,
    currentBrainId: "eng-notes-ab3xy",
    currentBrain: { display_name: "Eng notes", status: "ready" },
  });
  assert.equal(copy.kind, "active");
  assert.equal(copy.hint, "Active brain");
  assert.equal(copy.label, "Eng notes");
  assert.equal(copy.ariaLabel, "Active brain: Eng notes. Switch brain");
});

test("stale-link header still surfaces the missing id", () => {
  const copy = brainSwitcherCopy({
    loading: false,
    error: null,
    brainsCount: 2,
    currentBrainId: "default",
  });
  assert.equal(copy.kind, "stale-link");
  assert.equal(copy.label, "default");
  assert.match(copy.ariaLabel, /Brain not found: default/);
});
