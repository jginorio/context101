/**
 * Auto-ingest Lambda — triggered on S3 PutObject / DeleteObject from
 * any brain's docs bucket.
 *
 * The bucket name in the event identifies the brain. We look the brain
 * up in the BRAINS_TABLE registry to get the (kbId, dsId) pair, then
 * fire StartIngestionJob against the right KB. Multiple records in one
 * event can span different brains (S3 events normally don't fan across
 * buckets, but we group defensively).
 *
 * Multiple uploads in quick succession will each trigger this, but
 * StartIngestionJob is cheap and Bedrock handles queueing. ConflictException
 * means a job is already running — fine, it'll see the new files too.
 */
import {
  BedrockAgentClient,
  StartIngestionJobCommand,
} from "@aws-sdk/client-bedrock-agent";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const bedrock = new BedrockAgentClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const BRAINS_TABLE = process.env.BRAINS_TABLE;

// Cache the bucket → (brain_id, kb_id, ds_id) map in process memory. Lambda
// containers are reused across invocations, so this saves DDB calls on
// subsequent puts. TTL'd so newly-provisioned brains become routable within
// the cache lifetime without a redeploy.
let cache = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000;

async function loadRegistry() {
  const items = [];
  let exclusiveStartKey;
  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: BRAINS_TABLE,
        ProjectionExpression: "brain_id, docs_bucket, kb_id, ds_id, #s",
        ExpressionAttributeNames: { "#s": "status" },
        ExclusiveStartKey: exclusiveStartKey,
      })
    );
    items.push(...(res.Items ?? []));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);

  const byBucket = new Map();
  for (const row of items) {
    if (row.status !== "ready" || !row.docs_bucket || !row.kb_id || !row.ds_id) {
      continue;
    }
    byBucket.set(row.docs_bucket, {
      brainId: row.brain_id,
      kbId: row.kb_id,
      dsId: row.ds_id,
    });
  }
  return byBucket;
}

async function getRegistry() {
  const now = Date.now();
  if (cache && now - cacheLoadedAt < CACHE_TTL_MS) return cache;
  cache = await loadRegistry();
  cacheLoadedAt = now;
  return cache;
}

async function ingestForBucket(bucket, keys) {
  let registry = await getRegistry();
  let brain = registry.get(bucket);
  if (!brain) {
    // Cache miss can happen during the race between brain create and the
    // first S3 event. Force-refresh once.
    cache = null;
    registry = await getRegistry();
    brain = registry.get(bucket);
  }
  if (!brain) {
    console.warn(`no brain row matches bucket ${bucket}; skipping`);
    return { skipped: true, bucket };
  }
  try {
    const res = await bedrock.send(
      new StartIngestionJobCommand({
        knowledgeBaseId: brain.kbId,
        dataSourceId: brain.dsId,
        description: `Auto-triggered by S3 events on ${bucket}: ${keys
          .slice(0, 3)
          .join(", ")}`,
      })
    );
    console.log(
      `[brain=${brain.brainId}] started ingestion job ${res.ingestionJob?.ingestionJobId}`
    );
    return {
      bucket,
      brainId: brain.brainId,
      jobId: res.ingestionJob?.ingestionJobId,
    };
  } catch (err) {
    if (err.name === "ConflictException") {
      console.log(
        `[brain=${brain.brainId}] ingestion already in progress; new files will be picked up.`
      );
      return { bucket, brainId: brain.brainId, conflict: true };
    }
    throw err;
  }
}

export const handler = async (event) => {
  if (!BRAINS_TABLE) throw new Error("BRAINS_TABLE env var is required");

  // Group event records by bucket — one StartIngestionJob per bucket per call.
  const byBucket = new Map();
  for (const r of event.Records ?? []) {
    const bucket = r.s3?.bucket?.name;
    const key = r.s3?.object?.key;
    if (!bucket) continue;
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    if (key) byBucket.get(bucket).push(key);
  }

  const results = [];
  for (const [bucket, keys] of byBucket) {
    results.push(await ingestForBucket(bucket, keys));
  }
  return { statusCode: 200, results };
};
