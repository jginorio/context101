import assert from "node:assert/strict";
import { test } from "node:test";

import { keyFromUri } from "./wiki-retrieve";

test("keyFromUri strips s3://bucket/ from a retrieve location", () => {
  assert.equal(
    keyFromUri("s3://docs-bucket/verify/run/e2e.md"),
    "verify/run/e2e.md"
  );
  assert.equal(keyFromUri("verify/run/e2e.md"), "verify/run/e2e.md");
  assert.equal(keyFromUri(undefined), "");
  assert.equal(keyFromUri("s3://docs-bucket"), "docs-bucket");
});
