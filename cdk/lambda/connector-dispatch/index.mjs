/**
 * connector-dispatch Lambda
 *
 * Fired by EventBridge every 6h. For every ready brain in Postgres, queries
 * that brain's connectors table for status=connected or status=error rows
 * and invokes the right per-type sync Lambda for each. The per-invoke
 * payload carries the brain's connectors_table + docs_bucket + brain_id
 * so the sync Lambdas can route into the right brain without per-brain
 * Lambda copies.
 *
 * Kept deliberately dumb — no retries, no conditional logic. The per-type
 * Lambda owns the sync and writes its own status back to the row.
 */
import { createRequire } from "node:module";
import {
  LambdaClient,
  InvokeCommand,
} from "@aws-sdk/client-lambda";

// pg-http ships as a Lambda layer (zero-dependency Neon-over-HTTP helper).
const require = createRequire(import.meta.url);
const { pgQuery } = require("pg-http");

const lambdaClient = new LambdaClient({});

const DATABASE_URL = process.env.DATABASE_URL;

const FN_BY_TYPE = {
  sheets: process.env.SHEETS_SYNC_FN_NAME,
  docs: process.env.DOCS_SYNC_FN_NAME,
  slides: process.env.SLIDES_SYNC_FN_NAME,
  notion: process.env.NOTION_SYNC_FN_NAME,
  github: process.env.GITHUB_SYNC_FN_NAME,
};

async function listReadyBrains() {
  const { rows } = await pgQuery(
    DATABASE_URL,
    `select id, docs_bucket
       from brains
      where status = 'ready' and docs_bucket is not null`,
    []
  );
  return rows;
}

async function dispatchOneBrain(brain) {
  if (!brain.docs_bucket) {
    console.warn(`brain ${brain.id} missing docs_bucket; skipping`);
    return [];
  }

  // Include rows in both `connected` and `error` status so a transient
  // failure from the last run gets retried at the next tick.
  const { rows } = await pgQuery(
    DATABASE_URL,
    `select id, type
       from connectors
      where brain_id = $1 and status in ('connected', 'error')`,
    [brain.id]
  );

  const dispatched = [];
  for (const row of rows) {
    const fn = FN_BY_TYPE[row.type];
    if (!fn) {
      console.warn(
        `no sync fn for type=${row.type}, skipping ${row.id} in brain ${brain.id}`
      );
      continue;
    }
    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: fn,
        InvocationType: "Event", // fire-and-forget
        Payload: new TextEncoder().encode(
          JSON.stringify({
            connectorId: row.id,
            docsBucket: brain.docs_bucket,
            brainId: brain.id,
          })
        ),
      })
    );
    dispatched.push({ brainId: brain.id, id: row.id, type: row.type });
  }
  return dispatched;
}

export const handler = async () => {
  if (!DATABASE_URL) throw new Error("DATABASE_URL missing");

  const brains = await listReadyBrains();
  const all = [];
  for (const b of brains) {
    const got = await dispatchOneBrain(b);
    all.push(...got);
  }
  return { dispatched: all };
};
