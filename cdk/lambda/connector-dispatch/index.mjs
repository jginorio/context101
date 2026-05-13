/**
 * connector-dispatch Lambda
 *
 * Fired by EventBridge every 6h. For every brain in BRAINS_TABLE, queries
 * that brain's connectors table for status=connected or status=error rows
 * and invokes the right per-type sync Lambda for each. The per-invoke
 * payload carries the brain's connectors_table + docs_bucket + brain_id
 * so the sync Lambdas can route into the right brain without per-brain
 * Lambda copies.
 *
 * Kept deliberately dumb — no retries, no conditional logic. The per-type
 * Lambda owns the sync and writes its own status back to the row.
 */
import {
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  LambdaClient,
  InvokeCommand,
} from "@aws-sdk/client-lambda";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambdaClient = new LambdaClient({});

const BRAINS_TABLE = process.env.BRAINS_TABLE;

const FN_BY_TYPE = {
  sheets: process.env.SHEETS_SYNC_FN_NAME,
  docs: process.env.DOCS_SYNC_FN_NAME,
  slides: process.env.SLIDES_SYNC_FN_NAME,
  notion: process.env.NOTION_SYNC_FN_NAME,
  github: process.env.GITHUB_SYNC_FN_NAME,
};

async function listReadyBrains() {
  // Scan the brains table for status=ready rows. The table is small
  // (one row per brain — handfuls, not thousands) so a scan is fine and
  // avoids relying on a specific GSI from the dispatcher.
  const items = [];
  let exclusiveStartKey;
  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: BRAINS_TABLE,
        FilterExpression: "#s = :s",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":s": "ready" },
        ProjectionExpression: "brain_id, connectors_table, docs_bucket",
        ExclusiveStartKey: exclusiveStartKey,
      })
    );
    for (const it of res.Items ?? []) items.push(it);
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

async function dispatchOneBrain(brain) {
  if (!brain.connectors_table || !brain.docs_bucket) {
    console.warn(
      `brain ${brain.brain_id} missing connectors_table/docs_bucket; skipping`
    );
    return [];
  }

  // Include rows in both `connected` and `error` status so a transient
  // failure from the last run gets retried at the next tick.
  const statuses = ["connected", "error"];
  const dispatched = [];

  for (const status of statuses) {
    const q = await ddb.send(
      new QueryCommand({
        TableName: brain.connectors_table,
        IndexName: "status-created_at-index",
        KeyConditionExpression: "#s = :s",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":s": status },
      })
    );
    for (const row of q.Items ?? []) {
      const fn = FN_BY_TYPE[row.type];
      if (!fn) {
        console.warn(
          `no sync fn for type=${row.type}, skipping ${row.id} in brain ${brain.brain_id}`
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
              connectorsTable: brain.connectors_table,
              docsBucket: brain.docs_bucket,
              brainId: brain.brain_id,
            })
          ),
        })
      );
      dispatched.push({
        brainId: brain.brain_id,
        id: row.id,
        type: row.type,
      });
    }
  }
  return dispatched;
}

export const handler = async () => {
  if (!BRAINS_TABLE) throw new Error("BRAINS_TABLE missing");

  const brains = await listReadyBrains();
  const all = [];
  for (const b of brains) {
    const got = await dispatchOneBrain(b);
    all.push(...got);
  }
  return { dispatched: all };
};
