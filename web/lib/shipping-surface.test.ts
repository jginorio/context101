import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));

test("isolated conflicts restore wires reportEvidence on retrieve", () => {
  const src = readFileSync(path.join(here, "wiki-retrieve.ts"), "utf8");
  assert.equal(src.includes("conflictScope"), true);
  assert.equal(src.includes("reportEvidence"), true);
  assert.equal(src.includes("@/lib/conflicts"), true);
});
