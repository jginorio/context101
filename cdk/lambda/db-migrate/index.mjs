/**
 * Apply bundled Drizzle SQL migrations to a fresh RDS (or any Postgres)
 * control plane. Idempotent: records applied files in
 * context101_schema_migrations.
 *
 * Used as a CloudFormation custom resource when CREATE_RDS=true.
 */
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { pgExecute } = require("pg-http");

const DATABASE_URL = process.env.DATABASE_URL;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRIZZLE_DIR = path.join(HERE, "drizzle");

function statementsFromSql(sql) {
  return sql
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter(Boolean);
}

async function applyMigrations() {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not configured");

  await pgExecute(
    DATABASE_URL,
    `CREATE TABLE IF NOT EXISTS context101_schema_migrations (
       id text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`
  );

  const journal = JSON.parse(
    await readFile(path.join(DRIZZLE_DIR, "_journal.json"), "utf8")
  );
  const entries = [...(journal.entries || [])].sort((a, b) => a.idx - b.idx);

  for (const entry of entries) {
    const id = entry.tag;
    const already = await pgExecute(
      DATABASE_URL,
      "SELECT 1 FROM context101_schema_migrations WHERE id = $1",
      [id]
    );
    if (already > 0) continue;

    const sql = await readFile(path.join(DRIZZLE_DIR, `${id}.sql`), "utf8");
    for (const statement of statementsFromSql(sql)) {
      await pgExecute(DATABASE_URL, statement);
    }
    await pgExecute(
      DATABASE_URL,
      "INSERT INTO context101_schema_migrations (id) VALUES ($1)",
      [id]
    );
  }

  return { applied: entries.map((e) => e.tag) };
}

export async function handler(event) {
  if (event.RequestType === "Delete") {
    return { PhysicalResourceId: event.PhysicalResourceId || "context101-db-schema" };
  }
  const result = await applyMigrations();
  return {
    PhysicalResourceId: "context101-db-schema",
    Data: { Applied: result.applied.join(",") },
  };
}
