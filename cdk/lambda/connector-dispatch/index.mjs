/**
 * connector-dispatch Lambda
 *
 * Fired by EventBridge every 6h. Enumerates all `connected` rows in the
 * connectors table and invokes the right sync Lambda for each.
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
} from "@aws-sdk/lib-dynamodb";
import {
  LambdaClient,
  InvokeCommand,
} from "@aws-sdk/client-lambda";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambdaClient = new LambdaClient({});

const CONNECTORS_TABLE = process.env.CONNECTORS_TABLE;

const FN_BY_TYPE = {
  sheets: process.env.SHEETS_SYNC_FN_NAME,
  docs: process.env.DOCS_SYNC_FN_NAME,
  slides: process.env.SLIDES_SYNC_FN_NAME,
  // notion: process.env.NOTION_SYNC_FN_NAME  (v2)
};

export const handler = async () => {
  if (!CONNECTORS_TABLE) throw new Error("CONNECTORS_TABLE missing");

  // Include rows in both `connected` and `error` status so a transient
  // failure from the last run gets retried at the next tick.
  const statuses = ["connected", "error"];
  const dispatched = [];

  for (const status of statuses) {
    const q = await ddb.send(
      new QueryCommand({
        TableName: CONNECTORS_TABLE,
        IndexName: "status-created_at-index",
        KeyConditionExpression: "#s = :s",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":s": status },
      })
    );
    for (const row of q.Items ?? []) {
      const fn = FN_BY_TYPE[row.type];
      if (!fn) {
        console.warn(`no sync fn for type=${row.type}, skipping ${row.id}`);
        continue;
      }
      await lambdaClient.send(
        new InvokeCommand({
          FunctionName: fn,
          InvocationType: "Event", // fire-and-forget
          Payload: new TextEncoder().encode(
            JSON.stringify({ connectorId: row.id })
          ),
        })
      );
      dispatched.push({ id: row.id, type: row.type });
    }
  }
  return { dispatched };
};
