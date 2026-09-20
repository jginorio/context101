import assert from "node:assert/strict";
import { test } from "node:test";

import {
  connectorHasSyncedContent,
  visibleConnectorTypes,
  visibleProviderGroups,
} from "./knowledge-sources";

test("connectorHasSyncedContent is item_count > 0, not status alone", () => {
  assert.equal(
    connectorHasSyncedContent({
      type: "docs",
      status: "connected",
      item_count: 23,
    }),
    true
  );
  assert.equal(
    connectorHasSyncedContent({
      type: "docs",
      status: "connected",
      item_count: 0,
    }),
    false
  );
  assert.equal(
    connectorHasSyncedContent({ type: "docs", status: "connected" }),
    false
  );
});

test("Platea case: docs connector with items shows Docs even if sources/ has only github", () => {
  const types = visibleConnectorTypes({
    sourceFolders: ["github"],
    connectors: [
      {
        type: "docs",
        status: "connected",
        item_count: 23,
      },
      {
        type: "github",
        status: "connected",
        item_count: 8,
      },
    ],
  });
  assert.deepEqual(types, ["docs", "github"]);

  const groups = visibleProviderGroups(types);
  assert.deepEqual(
    groups.map((group) => ({ id: group.id, types: group.types })),
    [
      { id: "google", types: ["docs"] },
      { id: "github", types: ["github"] },
    ]
  );
});

test("S3 folder alone still shows the type (GitHub without a stale connector row)", () => {
  assert.deepEqual(
    visibleConnectorTypes({
      sourceFolders: ["github", "docs"],
      connectors: [],
    }),
    ["docs", "github"]
  );
});

test("unknown folders and empty connectors stay hidden", () => {
  assert.deepEqual(
    visibleConnectorTypes({
      sourceFolders: ["google", "wiki", "uploads"],
      connectors: [
        { type: "google", status: "connected", item_count: 4 },
        { type: "docs", status: "pending_auth", item_count: 0 },
        { type: "sheets", status: "connected", item_count: 0 },
      ],
    }),
    []
  );
});

test("Google group fans out docs / sheets / slides in contract order", () => {
  const types = visibleConnectorTypes({
    sourceFolders: ["slides", "docs", "sheets", "github"],
    connectors: null,
  });
  assert.deepEqual(types, ["docs", "sheets", "slides", "github"]);
  const google = visibleProviderGroups(types).find((g) => g.id === "google");
  assert.deepEqual(google?.types, ["docs", "sheets", "slides"]);
});
