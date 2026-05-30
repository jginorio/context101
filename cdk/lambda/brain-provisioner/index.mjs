/**
 * brain-provisioner Lambda
 *
 * Control-plane handler invoked by SSR /api/brains/{create,delete}.
 *
 * Event shape:
 *   { action: "create", brain_id, display_name, description?,
 *     org_id, created_by, created_by_email? }
 *   { action: "delete", brain_id }
 *
 * The brain registry is the Postgres `brains` table (control-plane source
 * of truth, shared with the web app + MCP server). For "create" the row is
 * written with status=provisioning first, then resource creation happens,
 * then status flips to "ready" (or "error" with error_msg). For "delete"
 * the row is flipped to status=deleting, AWS resources are torn down, then
 * the row is removed (connectors/suggestions/mcp_tokens cascade). The web
 * UI polls the registry for state.
 *
 * Idempotency: create() checks the existing row's resource handles before
 * each step, so a partial failure can be re-run. delete() tolerates
 * already-gone resources (treats NotFound as success).
 *
 * IAM scoping (see CDK): all operations are scoped to a fixed naming
 * pattern (`context101-brain-*`) so this Lambda cannot touch anything
 * else in the account.
 */
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import {
  BedrockAgentClient,
  CreateKnowledgeBaseCommand,
  CreateDataSourceCommand,
  DeleteDataSourceCommand,
  DeleteKnowledgeBaseCommand,
  GetKnowledgeBaseCommand,
  GetDataSourceCommand,
} from "@aws-sdk/client-bedrock-agent";
import {
  LambdaClient,
  AddPermissionCommand,
  RemovePermissionCommand,
} from "@aws-sdk/client-lambda";
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  PutBucketVersioningCommand,
  PutBucketEncryptionCommand,
  PutPublicAccessBlockCommand,
  PutBucketNotificationConfigurationCommand,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import {
  S3VectorsClient,
  CreateIndexCommand,
  DeleteIndexCommand,
  GetIndexCommand,
} from "@aws-sdk/client-s3vectors";
import {
  SecretsManagerClient,
  CreateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

// pg-http ships as a Lambda layer (zero-dependency Neon-over-HTTP helper).
// ESM doesn't resolve layer modules via NODE_PATH, so reach it through a
// CommonJS require bound to this module's URL.
const require = createRequire(import.meta.url);
const { pgFetchOne, pgExecute } = require("pg-http");

const REGION = process.env.AWS_REGION || "us-east-1";
const ACCOUNT = process.env.AWS_ACCOUNT_ID;
const DATABASE_URL = process.env.DATABASE_URL;
const VECTOR_BUCKET_NAME = process.env.VECTOR_BUCKET_NAME;
const SHARED_KB_ROLE_ARN = process.env.SHARED_KB_ROLE_ARN;
const AUTO_INGEST_FN_ARN = process.env.AUTO_INGEST_FN_ARN;
const EMBED_MODEL_ARN = process.env.EMBED_MODEL_ARN;
const EMBED_DIM = parseInt(process.env.EMBED_DIM || "1024", 10);

const bedrock = new BedrockAgentClient({});
const s3 = new S3Client({});
const s3vectors = new S3VectorsClient({});
const secrets = new SecretsManagerClient({});
const lambdaClient = new LambdaClient({});

function isAlreadyExists(err) {
  if (!err) return false;
  const name = err.name || err.Code;
  return (
    name === "BucketAlreadyOwnedByYou" ||
    name === "ResourceInUseException" ||
    name === "ConflictException" ||
    name === "AlreadyExistsException" ||
    name === "ResourceAlreadyExistsException"
  );
}

function isNotFound(err) {
  if (!err) return false;
  const name = err.name || err.Code;
  return (
    name === "NoSuchBucket" ||
    name === "NoSuchKey" ||
    name === "ResourceNotFoundException" ||
    name === "NotFoundException" ||
    name === "NoSuchEntity"
  );
}

// S3 bucket names cap at 63 characters. The previous shape was
//   context101-brain-<brainId>-<ACCOUNT>-<REGION>
// which busts the cap easily — a 56-char brainId (max from the web
// route's slugify(50) + nanoid(5)) on us-east-1 came out to ~87
// chars, and CreateBucket would 400 with InvalidBucketName.
//
// New shape:
//   context101-brain-<brainId[:32]>-<hash8>
//
// `hash8` is 8 hex chars of SHA-256 over the *full* brainId + account.
// That keeps the bucket globally unique across both (a) brainId
// collisions between two AWS accounts (different account → different
// hash) and (b) the rare case where two different long brainIds share
// the same 32-char prefix (different brainId → different hash).
//
// Budget: "context101-brain-" (17) + brainId[:32] (32) + "-" (1) +
// hash8 (8) = max 58 chars. Comfortably under 63 with headroom.
//
// The bucket name is stored on the brain registry row (`docs_bucket`)
// and read from there by every other component — nothing else
// reconstructs the name, so we're free to change the formula.
const BUCKET_BRAINID_MAX = 32;

function shortHash(brainId) {
  return createHash("sha256")
    .update(`${brainId}\0${ACCOUNT}`)
    .digest("hex")
    .slice(0, 8);
}

function bucketName(brainId) {
  const prefix = brainId.slice(0, BUCKET_BRAINID_MAX);
  const name = `context101-brain-${prefix}-${shortHash(brainId)}`;
  // Defensive guard: the math says we can't overflow, but if a future
  // edit ever loosens the regex on brain_id (e.g. allows uppercase) or
  // bumps the prefix budget, fail loudly here rather than during the
  // S3 API call.
  if (name.length < 3 || name.length > 63) {
    throw new Error(
      `bucket name out of range (${name.length} chars): ${name}`
    );
  }
  return name;
}

// S3 Vectors index names cap at 63 characters — same constraint as
// the S3 bucket. Use the same prefix-plus-hash shape so a long
// brain_id can't blow it up. Index names live under a single
// VECTOR_BUCKET, so collisions across accounts aren't possible —
// the account-mixing hash is still useful as a tie-breaker between
// two long brain_ids that share a 32-char prefix.
const INDEX_BRAINID_MAX = 32;

function indexName(brainId) {
  const prefix = brainId.slice(0, INDEX_BRAINID_MAX);
  const name = `context101-brain-${prefix}-${shortHash(brainId)}`;
  if (name.length > 63) {
    throw new Error(
      `index name out of range (${name.length} chars): ${name}`
    );
  }
  return name;
}

function indexArn(brainId) {
  return `arn:aws:s3vectors:${REGION}:${ACCOUNT}:bucket/${VECTOR_BUCKET_NAME}/index/${indexName(brainId)}`;
}

function tokenSecretName(brainId) {
  return `context101-brain-${brainId}-token`;
}

async function createBrainBucket(name) {
  try {
    await s3.send(
      new CreateBucketCommand({
        Bucket: name,
        // us-east-1 must NOT include LocationConstraint; other regions must.
        ...(REGION !== "us-east-1"
          ? { CreateBucketConfiguration: { LocationConstraint: REGION } }
          : {}),
      })
    );
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
  }
  await s3.send(
    new PutPublicAccessBlockCommand({
      Bucket: name,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      },
    })
  );
  await s3.send(
    new PutBucketEncryptionCommand({
      Bucket: name,
      ServerSideEncryptionConfiguration: {
        Rules: [
          {
            ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" },
          },
        ],
      },
    })
  );
  await s3.send(
    new PutBucketVersioningCommand({
      Bucket: name,
      VersioningConfiguration: { Status: "Enabled" },
    })
  );
}

async function wireAutoIngestNotification(bucket) {
  // Grant the bucket → Lambda invoke permission first (idempotent: the
  // Lambda's ResourcePolicy holds one statement per StatementId).
  const sid = `s3-${bucket}`.slice(0, 100);
  try {
    await lambdaClient.send(
      new AddPermissionCommand({
        FunctionName: AUTO_INGEST_FN_ARN,
        StatementId: sid,
        Action: "lambda:InvokeFunction",
        Principal: "s3.amazonaws.com",
        SourceArn: `arn:aws:s3:::${bucket}`,
        SourceAccount: ACCOUNT,
      })
    );
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
  }
  await s3.send(
    new PutBucketNotificationConfigurationCommand({
      Bucket: bucket,
      NotificationConfiguration: {
        LambdaFunctionConfigurations: [
          {
            Id: "auto-ingest-created",
            LambdaFunctionArn: AUTO_INGEST_FN_ARN,
            Events: ["s3:ObjectCreated:*"],
          },
          {
            Id: "auto-ingest-removed",
            LambdaFunctionArn: AUTO_INGEST_FN_ARN,
            Events: ["s3:ObjectRemoved:*"],
          },
        ],
      },
    })
  );
}

async function createVectorIndex(brainId) {
  try {
    await s3vectors.send(
      new CreateIndexCommand({
        vectorBucketName: VECTOR_BUCKET_NAME,
        indexName: indexName(brainId),
        dataType: "float32",
        dimension: EMBED_DIM,
        distanceMetric: "cosine",
        metadataConfiguration: {
          nonFilterableMetadataKeys: [
            "AMAZON_BEDROCK_TEXT",
            "AMAZON_BEDROCK_METADATA",
          ],
        },
      })
    );
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
  }
  // Sanity poll — CreateIndex is fast but eventually consistent in some cases.
  for (let i = 0; i < 10; i++) {
    try {
      await s3vectors.send(
        new GetIndexCommand({
          vectorBucketName: VECTOR_BUCKET_NAME,
          indexName: indexName(brainId),
        })
      );
      return;
    } catch (err) {
      if (!isNotFound(err)) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Vector index ${indexName(brainId)} not observable after create`);
}

async function createBrainKb(brainId) {
  const res = await bedrock.send(
    new CreateKnowledgeBaseCommand({
      name: `context101-brain-${brainId}`,
      description: `Context101 brain: ${brainId}`,
      roleArn: SHARED_KB_ROLE_ARN,
      knowledgeBaseConfiguration: {
        type: "VECTOR",
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: EMBED_MODEL_ARN,
          embeddingModelConfiguration: {
            bedrockEmbeddingModelConfiguration: { dimensions: EMBED_DIM },
          },
        },
      },
      storageConfiguration: {
        type: "S3_VECTORS",
        s3VectorsConfiguration: { indexArn: indexArn(brainId) },
      },
    })
  );
  return res.knowledgeBase?.knowledgeBaseId;
}

async function createBrainDataSource(kbId, bucket) {
  const res = await bedrock.send(
    new CreateDataSourceCommand({
      knowledgeBaseId: kbId,
      name: "markdown-docs",
      dataSourceConfiguration: {
        type: "S3",
        s3Configuration: { bucketArn: `arn:aws:s3:::${bucket}` },
      },
    })
  );
  return res.dataSource?.dataSourceId;
}

async function createBrainToken(brainId) {
  const value = randomBytes(32).toString("hex");
  try {
    const res = await secrets.send(
      new CreateSecretCommand({
        Name: tokenSecretName(brainId),
        Description: `Bearer token for Context101 brain ${brainId}`,
        SecretString: value,
      })
    );
    return res.ARN;
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    // Already there from a partial run — fetch the real ARN via Describe.
    // We can't reconstruct it ourselves because Secrets Manager appends
    // a 6-char random suffix (e.g. `-AbCdEf`) at create time. A partial
    // ARN without that suffix works as a SecretId for most calls (AWS
    // resolves partial ARNs server-side), but storing the partial form
    // in the BrainsTable would be misleading when debugging or auditing
    // — the registry row would show an ARN that doesn't actually exist
    // verbatim in Secrets Manager. DescribeSecret returns the full ARN.
    const desc = await secrets.send(
      new DescribeSecretCommand({ SecretId: tokenSecretName(brainId) })
    );
    if (!desc.ARN) {
      throw new Error(
        `DescribeSecret returned no ARN for ${tokenSecretName(brainId)}`
      );
    }
    return desc.ARN;
  }
}

// ── Postgres registry helpers ────────────────────────────────────────
// The brain registry lives in Postgres (`brains` table). The connection
// role (neondb_owner) bypasses RLS, so we filter by org_id explicitly.

async function setBrainStatus(brainId, status, errorMsg) {
  await pgExecute(
    DATABASE_URL,
    `update brains
       set status = $2, error_msg = $3, updated_at = now()
     where id = $1`,
    [brainId, status, errorMsg ?? null]
  );
}

async function createBrain({
  brain_id,
  display_name,
  description,
  org_id,
  created_by,
  created_by_email,
}) {
  if (!brain_id || !display_name) {
    throw new Error("brain_id and display_name are required");
  }
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(brain_id)) {
    throw new Error(`invalid brain_id: ${brain_id}`);
  }
  if (!org_id) throw new Error("org_id is required");
  // `created_by` is NOT NULL in Postgres; fall back to the email or a
  // sentinel so a provisioning row can always be written.
  const createdBy = created_by || created_by_email || "unknown";

  // Step 0: insert row, fail if id taken — unless the existing row is in
  // `error` status (retry of a failed provision) and belongs to the same org.
  const inserted = await pgFetchOne(
    DATABASE_URL,
    `insert into brains (id, org_id, display_name, description, status, created_by)
     values ($1, $2, $3, $4, 'provisioning', $5)
     on conflict (id) do nothing
     returning id`,
    [brain_id, org_id, display_name, description || null, createdBy]
  );

  if (!inserted) {
    const cur = await pgFetchOne(
      DATABASE_URL,
      `select status, org_id from brains where id = $1`,
      [brain_id]
    );
    if (!cur) throw new Error(`brain_id ${brain_id} insert race`);
    if (cur.org_id !== org_id) {
      throw new Error(`brain_id ${brain_id} already exists`);
    }
    // A `ready` or `deleting` brain with this id is a genuine collision.
    // A `provisioning` row is expected: the web route pre-inserts it so the
    // UI can poll immediately, and a re-run of a failed (`error`) provision
    // should resume. In both cases, (re)start the AWS provisioning steps.
    if (cur.status === "ready" || cur.status === "deleting") {
      throw new Error(`brain_id ${brain_id} already exists`);
    }
    await pgExecute(
      DATABASE_URL,
      `update brains
         set status = 'provisioning', error_msg = null,
             display_name = $2, description = $3, updated_at = now()
       where id = $1`,
      [brain_id, display_name, description || null]
    );
  }

  try {
    const bucket = bucketName(brain_id);
    await createBrainBucket(bucket);
    await wireAutoIngestNotification(bucket);
    await createVectorIndex(brain_id);
    const kbId = await createBrainKb(brain_id);
    const dsId = await createBrainDataSource(kbId, bucket);
    const tokenSecretArn = await createBrainToken(brain_id);

    await pgExecute(
      DATABASE_URL,
      `update brains
         set status = 'ready',
             docs_bucket = $2,
             vector_index_arn = $3,
             kb_id = $4,
             ds_id = $5,
             token_secret_arn = $6,
             error_msg = null,
             updated_at = now()
       where id = $1`,
      [
        brain_id,
        bucket,
        indexArn(brain_id),
        kbId,
        dsId,
        tokenSecretArn,
      ]
    );

    return {
      ok: true,
      brain_id,
      kb_id: kbId,
      ds_id: dsId,
      docs_bucket: bucket,
      token_secret_arn: tokenSecretArn,
    };
  } catch (err) {
    const msg = err?.message || String(err);
    console.error(`provisioning failed for ${brain_id}:`, err);
    try {
      await setBrainStatus(brain_id, "error", msg.slice(0, 1000));
    } catch (e2) {
      console.error("also failed to update error status:", e2);
    }
    throw err;
  }
}

async function emptyBucket(bucket) {
  let keyMarker;
  let versionIdMarker;
  while (true) {
    const res = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      })
    );
    const toDelete = [
      ...(res.Versions || []).map((v) => ({ Key: v.Key, VersionId: v.VersionId })),
      ...(res.DeleteMarkers || []).map((d) => ({ Key: d.Key, VersionId: d.VersionId })),
    ];
    if (toDelete.length > 0) {
      // DeleteObjects caps at 1000 per call.
      for (let i = 0; i < toDelete.length; i += 1000) {
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: toDelete.slice(i, i + 1000), Quiet: true },
          })
        );
      }
    }
    if (!res.IsTruncated) break;
    keyMarker = res.NextKeyMarker;
    versionIdMarker = res.NextVersionIdMarker;
  }
}

async function deleteBrain({ brain_id }) {
  if (!brain_id) throw new Error("brain_id required");
  if (brain_id === "default") {
    throw new Error("the default brain cannot be deleted");
  }

  const row = await pgFetchOne(
    DATABASE_URL,
    `select id, docs_bucket, kb_id, ds_id from brains where id = $1`,
    [brain_id]
  );
  if (!row) {
    return { ok: true, alreadyGone: true };
  }

  await setBrainStatus(brain_id, "deleting", null);

  // Tear down in reverse order. Each step tolerates NotFound.
  // 1. Empty + delete bucket.
  if (row.docs_bucket) {
    try {
      await emptyBucket(row.docs_bucket);
      await s3.send(new DeleteBucketCommand({ Bucket: row.docs_bucket }));
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    // Best-effort: remove the Lambda invoke permission we added.
    try {
      await lambdaClient.send(
        new RemovePermissionCommand({
          FunctionName: AUTO_INGEST_FN_ARN,
          StatementId: `s3-${row.docs_bucket}`.slice(0, 100),
        })
      );
    } catch (err) {
      if (!isNotFound(err)) console.warn("RemovePermission failed:", err.message);
    }
  }

  // 2. Delete the data source + KB.
  if (row.kb_id) {
    if (row.ds_id) {
      try {
        await bedrock.send(
          new DeleteDataSourceCommand({
            knowledgeBaseId: row.kb_id,
            dataSourceId: row.ds_id,
          })
        );
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    }
    try {
      await bedrock.send(
        new DeleteKnowledgeBaseCommand({ knowledgeBaseId: row.kb_id })
      );
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  // 3. Delete the vector index.
  try {
    await s3vectors.send(
      new DeleteIndexCommand({
        vectorBucketName: VECTOR_BUCKET_NAME,
        indexName: indexName(brain_id),
      })
    );
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }

  // 4. Delete the bearer token secret (force, no recovery window).
  try {
    await secrets.send(
      new DeleteSecretCommand({
        SecretId: tokenSecretName(brain_id),
        ForceDeleteWithoutRecovery: true,
      })
    );
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }

  // 5. Remove the registry row. Connectors, suggestions, and mcp_tokens
  //    cascade-delete via their brain_id foreign keys.
  await pgExecute(DATABASE_URL, `delete from brains where id = $1`, [brain_id]);

  return { ok: true, brain_id };
}

export const handler = async (event = {}) => {
  if (!DATABASE_URL) throw new Error("DATABASE_URL env missing");
  if (!ACCOUNT) throw new Error("AWS_ACCOUNT_ID env missing");
  const action = event.action;
  if (action === "create") return await createBrain(event);
  if (action === "delete") return await deleteBrain(event);
  throw new Error(`unknown action: ${action}`);
};
