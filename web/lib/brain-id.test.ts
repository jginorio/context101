import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveRequestedBrainId } from "./brain-id";

test("empty query, header, and cookie means no brain is selected", () => {
  assert.equal(resolveRequestedBrainId({}), null);
  assert.equal(resolveRequestedBrainId({ query: "", header: "", cookie: "" }), null);
  assert.equal(
    resolveRequestedBrainId({ query: "  ", header: "\t", cookie: null }),
    null
  );
});

test("never invents a default id when nothing was requested", () => {
  const id = resolveRequestedBrainId({
    query: null,
    header: null,
    cookie: null,
  });
  assert.equal(id, null);
  assert.notEqual(id, "default");
});

test("query wins over header and cookie", () => {
  assert.equal(
    resolveRequestedBrainId({
      query: "from-query",
      header: "from-header",
      cookie: "from-cookie",
    }),
    "from-query"
  );
});

test("header wins over cookie when query is empty", () => {
  assert.equal(
    resolveRequestedBrainId({
      query: "",
      header: "from-header",
      cookie: "from-cookie",
    }),
    "from-header"
  );
});

test("cookie is used when query and header are empty", () => {
  assert.equal(
    resolveRequestedBrainId({ cookie: " leftover " }),
    "leftover"
  );
});

test("an explicit default id is preserved — only implicit fallback is gone", () => {
  assert.equal(resolveRequestedBrainId({ cookie: "default" }), "default");
  assert.equal(resolveRequestedBrainId({ query: "default" }), "default");
});
