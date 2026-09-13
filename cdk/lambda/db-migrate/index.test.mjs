import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { applyMigrations, handler, statementsFromSql } from "./index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRIZZLE_DIR = path.join(HERE, "drizzle");
const RDS_URL =
  "postgresql://context101:secret@context101.xxxx.rds.amazonaws.com:5432/context101?sslmode=require";

test("statementsFromSql splits drizzle breakpoints", () => {
  const parts = statementsFromSql(
    "CREATE TYPE x AS ENUM('a');\n--> statement-breakpoint\nCREATE TABLE t (id text);"
  );
  assert.deepEqual(parts, [
    "CREATE TYPE x AS ENUM('a');",
    "CREATE TABLE t (id text);",
  ]);
});

test("applyMigrations runs drizzle SQL through pgExecute", async () => {
  const journal = JSON.parse(
    await readFile(path.join(DRIZZLE_DIR, "_journal.json"), "utf8")
  );
  const tags = journal.entries.map((e) => e.tag);
  const firstSql = await readFile(
    path.join(DRIZZLE_DIR, `${tags[0]}.sql`),
    "utf8"
  );
  const firstStatements = statementsFromSql(firstSql);

  const calls = [];
  const result = await applyMigrations({
    databaseUrl: RDS_URL,
    drizzleDir: DRIZZLE_DIR,
    execute: async (url, sql, params) => {
      calls.push({ url, sql, params });
      return 0;
    },
  });

  assert.deepEqual(result.applied, tags);
  assert.equal(
    calls.every((c) => c.url === RDS_URL),
    true
  );
  assert.match(calls[0].sql, /context101_schema_migrations/);
  assert.match(calls[1].sql, /SELECT 1 FROM context101_schema_migrations/);
  assert.deepEqual(calls[1].params, [tags[0]]);
  assert.equal(calls[2].sql, firstStatements[0]);
  const firstInsert = calls.find(
    (c) =>
      /INSERT INTO context101_schema_migrations/.test(c.sql) &&
      c.params?.[0] === tags[0]
  );
  assert.ok(firstInsert);
  assert.equal(
    calls.filter((c) => /INSERT INTO context101_schema_migrations/.test(c.sql))
      .length,
    tags.length
  );
});

test("applyMigrations skips files already recorded", async () => {
  const calls = [];
  const result = await applyMigrations({
    databaseUrl: RDS_URL,
    drizzleDir: DRIZZLE_DIR,
    execute: async (url, sql, params) => {
      calls.push({ url, sql, params });
      if (/SELECT 1 FROM context101_schema_migrations/.test(sql)) return 1;
      return 0;
    },
  });

  assert.ok(result.applied.length > 0);
  assert.equal(
    calls.some((c) => c.sql.includes("CREATE TYPE")),
    false
  );
  assert.equal(
    calls.filter((c) => /INSERT INTO context101_schema_migrations/.test(c.sql))
      .length,
    0
  );
});

test("handler Delete does not migrate", async () => {
  const out = await handler({ RequestType: "Delete", PhysicalResourceId: "x" });
  assert.equal(out.PhysicalResourceId, "x");
});

test("default driver is still pg-http", async () => {
  const src = await readFile(path.join(HERE, "index.mjs"), "utf8");
  assert.match(src, /require\("pg-http"\)/);
  assert.match(src, /pgExecute/);
  await assert.rejects(
    () => applyMigrations({ databaseUrl: RDS_URL, drizzleDir: DRIZZLE_DIR }),
    /pg-http/
  );
});
