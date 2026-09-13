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

function defaultExecute() {
  const { pgExecute } = require("pg-http");
  return pgExecute;
}

const DATABASE_URL = process.env.DATABASE_URL;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRIZZLE_DIR = path.join(HERE, "drizzle");

export function statementsFromSql(sql) {
  return sql
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter(Boolean);
}

export async function applyMigrations(opts = {}) {
  const databaseUrl = opts.databaseUrl ?? DATABASE_URL;
  const drizzleDir = opts.drizzleDir ?? DRIZZLE_DIR;
  const execute = opts.execute ?? defaultExecute();

  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");

  await execute(
    databaseUrl,
    `CREATE TABLE IF NOT EXISTS context101_schema_migrations (
       id text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`
  );

  const journal = JSON.parse(
    await readFile(path.join(drizzleDir, "_journal.json"), "utf8")
  );
  const entries = [...(journal.entries || [])].sort((a, b) => a.idx - b.idx);

  for (const entry of entries) {
    const id = entry.tag;
    const already = await execute(
      databaseUrl,
      "SELECT 1 FROM context101_schema_migrations WHERE id = $1",
      [id]
    );
    if (already > 0) continue;

    const sql = await readFile(path.join(drizzleDir, `${id}.sql`), "utf8");
    for (const statement of statementsFromSql(sql)) {
      await execute(databaseUrl, statement);
    }
    await execute(
      databaseUrl,
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
