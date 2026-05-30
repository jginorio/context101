import { neon } from "@neondatabase/serverless";
import { sql as drizzleSql } from "drizzle-orm";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as appSchema from "./schema";
import * as authSchema from "./auth-schema";

export const dbSchema = { ...authSchema, ...appSchema };

type DatabaseDriver = "neon-http" | "postgres-js";

const databaseUrl = process.env.DATABASE_URL;
const configuredDriver = process.env.DATABASE_DRIVER as DatabaseDriver | undefined;
const prepareStatements = process.env.DATABASE_PREPARE !== "false";

if (!databaseUrl && process.env.NODE_ENV !== "test") {
  console.warn("DATABASE_URL is not set; Postgres control-plane access is disabled.");
}

function inferDriver(url: string): DatabaseDriver {
  if (configuredDriver) return configuredDriver;
  return url.includes("neon.tech") ? "neon-http" : "postgres-js";
}

function createDatabase(url: string) {
  const driver = inferDriver(url);

  if (driver === "neon-http") {
    const client = neon(url);
    return drizzleNeon({ client, schema: dbSchema });
  }

  if (driver === "postgres-js") {
    const client = postgres(url, { prepare: prepareStatements });
    return drizzlePostgres(client, { schema: dbSchema });
  }

  throw new Error(`Unsupported DATABASE_DRIVER: ${driver satisfies never}`);
}

export const db = databaseUrl ? createDatabase(databaseUrl) : undefined;

type Database = NonNullable<typeof db>;
type TenantTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type TenantContext = {
  userId: string;
  orgId: string;
};

export async function withTenantTx<T>(
  ctx: TenantContext,
  fn: (tx: TenantTransaction) => Promise<T>
): Promise<T> {
  if (!db) throw new Error("DATABASE_URL is not configured");

  return db.transaction(async (tx) => {
    await tx.execute(drizzleSql`select set_config('app.user_id', ${ctx.userId}, true)`);
    await tx.execute(drizzleSql`select set_config('app.org_id', ${ctx.orgId}, true)`);
    return fn(tx);
  });
}
