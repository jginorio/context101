import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));

test("retrieve path source does not import or call conflict detect", () => {
  const src = readFileSync(path.join(here, "wiki-retrieve.ts"), "utf8");
  assert.equal(src.includes("conflictScope"), false);
  assert.equal(src.includes("reportEvidence"), false);
  assert.equal(src.includes("@/lib/conflicts"), false);
  assert.equal(src.includes("lib/conflicts"), false);
});

test("MCP search_knowledge does not post conflict evidence", () => {
  const src = readFileSync(path.join(here, "../../server.py"), "utf8");
  assert.equal(src.includes("/api/conflicts/evidence"), false);
  assert.equal(src.includes("_report_conflict_evidence"), false);
});

test("auto-ingest does not post conflict evidence", () => {
  const src = readFileSync(
    path.join(here, "../../cdk/lambda/auto-ingest/index.mjs"),
    "utf8"
  );
  assert.equal(src.includes("CONFLICT_EVIDENCE"), false);
  assert.equal(src.includes("postConflictEvidence"), false);
});

test("retrieve and chat API routes do not pass conflictScope", () => {
  const retrieve = readFileSync(
    path.join(here, "../app/api/wiki/retrieve/route.ts"),
    "utf8"
  );
  const chat = readFileSync(
    path.join(here, "../app/api/wiki/chat/route.ts"),
    "utf8"
  );
  assert.equal(retrieve.includes("conflictScope"), false);
  assert.equal(retrieve.includes("reportEvidence"), false);
  assert.equal(chat.includes("conflictScope"), false);
  assert.equal(chat.includes("reportEvidence"), false);
});
