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
  StartIngestionJobCommand,
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
  ListObjectsV2Command,
  CopyObjectCommand,
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

// `gen` is an optional generation salt. The default (no salt) hash is
// preserved byte-for-byte so existing brains' derived names are unchanged.
// A salt is used when re-embedding a brain in place: the new KB/index/bucket
// must have names distinct from the brain's current ones (which still exist
// and keep serving until the swap), even though the brain id is the same.
function shortHash(brainId, gen) {
  const input = gen
    ? `${brainId}\0${ACCOUNT}\0${gen}`
    : `${brainId}\0${ACCOUNT}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 8);
}

function bucketName(brainId, gen) {
  const prefix = brainId.slice(0, BUCKET_BRAINID_MAX);
  const name = `context101-brain-${prefix}-${shortHash(brainId, gen)}`;
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

function indexName(brainId, gen) {
  const prefix = brainId.slice(0, INDEX_BRAINID_MAX);
  const name = `context101-brain-${prefix}-${shortHash(brainId, gen)}`;
  if (name.length > 63) {
    throw new Error(
      `index name out of range (${name.length} chars): ${name}`
    );
  }
  return name;
}

function indexArnForName(name) {
  return `arn:aws:s3vectors:${REGION}:${ACCOUNT}:bucket/${VECTOR_BUCKET_NAME}/index/${name}`;
}

function indexArn(brainId, gen) {
  return indexArnForName(indexName(brainId, gen));
}

// Pull the index name back out of a stored s3vectors index ARN
// (…:bucket/<vbucket>/index/<indexName>). Used at teardown time so we delete
// the brain's *current* index, not one re-derived from the id (which may
// differ after an in-place re-embed).
function indexNameFromArn(arn) {
  if (!arn) return null;
  const m = /\/index\/([^/]+)$/.exec(arn);
  return m ? m[1] : null;
}

function tokenSecretName(brainId) {
  return `context101-brain-${brainId}-token`;
}

// Resolve a brain's embedding settings from the invoke event, falling back to
// the deploy-time defaults (Titan Embed v2 @ EMBED_DIM) for legacy create
// events that predate per-brain embedding selection.
function resolveEmbedding(event) {
  return {
    provider: event.embedding_model_provider || "aws",
    modelId: event.embedding_model_id || "amazon.titan-embed-text-v2:0",
    modelArn: event.embedding_model_arn || EMBED_MODEL_ARN,
    dimensions: Number(event.embedding_dimensions) || EMBED_DIM,
    // Only Titan Text v2 and Cohere Embed v4 accept a configurable embedding
    // dimension. For fixed-dimension models (Cohere v3, Titan G1/Multimodal)
    // Bedrock rejects the KB if a `dimensions` config is supplied, so we omit
    // it unless the web layer flagged the model as configurable.
    configurableDims: event.embedding_configurable_dims === true,
    chunking: event.embedding_chunking || { strategy: "default" },
  };
}

// Translate our normalized chunking config into the Bedrock data source
// `vectorIngestionConfiguration`. Returns undefined for the "default"
// strategy so Bedrock applies its built-in chunking.
function buildVectorIngestionConfiguration(chunking) {
  const strategy = chunking?.strategy ?? "default";
  if (strategy === "default") return undefined;
  if (strategy === "none") {
    return { chunkingConfiguration: { chunkingStrategy: "NONE" } };
  }
  if (strategy === "fixed") {
    return {
      chunkingConfiguration: {
        chunkingStrategy: "FIXED_SIZE",
        fixedSizeChunkingConfiguration: {
          maxTokens: chunking.maxTokens ?? 300,
          overlapPercentage: chunking.overlapPercentage ?? 20,
        },
      },
    };
  }
  if (strategy === "semantic") {
    return {
      chunkingConfiguration: {
        chunkingStrategy: "SEMANTIC",
        semanticChunkingConfiguration: {
          maxTokens: chunking.maxTokens ?? 300,
          bufferSize: chunking.bufferSize ?? 0,
          breakpointPercentileThreshold:
            chunking.breakpointPercentileThreshold ?? 95,
        },
      },
    };
  }
  if (strategy === "hierarchical") {
    return {
      chunkingConfiguration: {
        chunkingStrategy: "HIERARCHICAL",
        hierarchicalChunkingConfiguration: {
          levelConfigurations: [
            { maxTokens: chunking.parentMaxTokens ?? 1500 },
            { maxTokens: chunking.childMaxTokens ?? 300 },
          ],
          overlapTokens: chunking.overlapTokens ?? 60,
        },
      },
    };
  }
  return undefined;
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

async function createVectorIndex(idxName, dimension) {
  try {
    await s3vectors.send(
      new CreateIndexCommand({
        vectorBucketName: VECTOR_BUCKET_NAME,
        indexName: idxName,
        dataType: "float32",
        dimension: dimension || EMBED_DIM,
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
          indexName: idxName,
        })
      );
      return;
    } catch (err) {
      if (!isNotFound(err)) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Vector index ${idxName} not observable after create`);
}

async function createBrainKb(kbName, modelArn, dimension, idxArn, configurableDims) {
  const vectorConfig = {
    embeddingModelArn: modelArn || EMBED_MODEL_ARN,
    // Pass an explicit dimension ONLY for models that support it — fixed
    // models (Cohere v3, Titan G1/Multimodal) 400 with "does not support
    // configurable dimensions" if this block is present.
    ...(configurableDims
      ? {
          embeddingModelConfiguration: {
            bedrockEmbeddingModelConfiguration: {
              dimensions: dimension || EMBED_DIM,
            },
          },
        }
      : {}),
  };
  const res = await bedrock.send(
    new CreateKnowledgeBaseCommand({
      name: kbName,
      description: `Context101 brain KB: ${kbName}`,
      roleArn: SHARED_KB_ROLE_ARN,
      knowledgeBaseConfiguration: {
        type: "VECTOR",
        vectorKnowledgeBaseConfiguration: vectorConfig,
      },
      storageConfiguration: {
        type: "S3_VECTORS",
        s3VectorsConfiguration: { indexArn: idxArn },
      },
    })
  );
  return res.knowledgeBase?.knowledgeBaseId;
}

async function createBrainDataSource(kbId, bucket, chunking) {
  const vectorIngestionConfiguration =
    buildVectorIngestionConfiguration(chunking);
  const res = await bedrock.send(
    new CreateDataSourceCommand({
      knowledgeBaseId: kbId,
      name: "markdown-docs",
      dataSourceConfiguration: {
        type: "S3",
        s3Configuration: { bucketArn: `arn:aws:s3:::${bucket}` },
      },
      ...(vectorIngestionConfiguration
        ? { vectorIngestionConfiguration }
        : {}),
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

// Flip a provisioned brain to `ready`, writing its resource handles and
// embedding settings. Split out of createBrain so the replace/clone flow can
// defer the ready flip until *after* the source content has been copied in —
// otherwise the UI could see "ready" and switch/clean up mid-copy.
async function finalizeBrain(brainId, embedding, handles) {
  await pgExecute(
    DATABASE_URL,
    `update brains
       set status = 'ready',
           docs_bucket = $2,
           vector_index_arn = $3,
           kb_id = $4,
           ds_id = $5,
           token_secret_arn = $6,
           embedding_model_provider = $7,
           embedding_model_id = $8,
           embedding_model_arn = $9,
           embedding_dimensions = $10,
           embedding_chunking = $11,
           error_msg = null,
           updated_at = now()
     where id = $1`,
    [
      brainId,
      handles.bucket,
      indexArn(brainId),
      handles.kbId,
      handles.dsId,
      handles.tokenSecretArn,
      embedding.provider,
      embedding.modelId,
      embedding.modelArn,
      embedding.dimensions,
      embedding.chunking,
    ]
  );
}

async function createBrain(event, { finalize = true } = {}) {
  const {
    brain_id,
    display_name,
    description,
    org_id,
    created_by,
    created_by_email,
  } = event;
  const embedding = resolveEmbedding(event);
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
    await createVectorIndex(indexName(brain_id), embedding.dimensions);
    const kbId = await createBrainKb(
      `context101-brain-${brain_id}`,
      embedding.modelArn,
      embedding.dimensions,
      indexArn(brain_id),
      embedding.configurableDims
    );
    const dsId = await createBrainDataSource(kbId, bucket, embedding.chunking);
    const tokenSecretArn = await createBrainToken(brain_id);

    const handles = { bucket, kbId, dsId, tokenSecretArn };
    if (finalize) {
      await finalizeBrain(brain_id, embedding, handles);
    }

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

// Copy every object from one brain's docs bucket into another's, preserving
// keys (including `.metadata.json` sidecars). Paginated; each segment of the
// key is URL-encoded individually so slashes are preserved in CopySource.
async function copyBucketContents(srcBucket, dstBucket) {
  let token;
  let copied = 0;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: srcBucket,
        ContinuationToken: token,
      })
    );
    for (const obj of res.Contents || []) {
      if (!obj.Key) continue;
      const encodedKey = obj.Key.split("/").map(encodeURIComponent).join("/");
      await s3.send(
        new CopyObjectCommand({
          Bucket: dstBucket,
          Key: obj.Key,
          CopySource: `${srcBucket}/${encodedKey}`,
        })
      );
      copied++;
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return copied;
}

async function startIngestion(kbId, dsId) {
  if (!kbId || !dsId) return;
  try {
    await bedrock.send(
      new StartIngestionJobCommand({
        knowledgeBaseId: kbId,
        dataSourceId: dsId,
        description: "Ingestion after embedding re-embed",
      })
    );
  } catch (err) {
    // A job already running will pick up the freshly-copied files anyway.
    if (err.name !== "ConflictException") throw err;
  }
}

// Tear down a set of per-brain AWS resources (bucket, data source, KB, vector
// index). Used both by deleteBrain and by the in-place re-embed to dispose of
// a brain's *previous* resources after the swap.
//
// Guard: only resources under the `context101-brain-` naming convention are
// touched. The default brain's original bucket/KB/index are CDK-managed (named
// differently), so this safely skips them — we never delete stack-owned
// resources out-of-band.
async function teardownResources({ bucket, kbId, dsId, indexName: idxName }) {
  if (bucket && !bucket.startsWith("context101-brain-")) {
    console.warn(
      `teardown skipped: ${bucket} is not a provisioner-managed bucket (likely CDK-managed); leaving its KB/index intact`
    );
    return;
  }

  if (bucket) {
    try {
      await emptyBucket(bucket);
      await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    try {
      await lambdaClient.send(
        new RemovePermissionCommand({
          FunctionName: AUTO_INGEST_FN_ARN,
          StatementId: `s3-${bucket}`.slice(0, 100),
        })
      );
    } catch (err) {
      if (!isNotFound(err)) console.warn("RemovePermission failed:", err.message);
    }
  }

  if (kbId) {
    if (dsId) {
      try {
        await bedrock.send(
          new DeleteDataSourceCommand({
            knowledgeBaseId: kbId,
            dataSourceId: dsId,
          })
        );
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    }
    try {
      await bedrock.send(
        new DeleteKnowledgeBaseCommand({ knowledgeBaseId: kbId })
      );
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  if (idxName) {
    try {
      await s3vectors.send(
        new DeleteIndexCommand({
          vectorBucketName: VECTOR_BUCKET_NAME,
          indexName: idxName,
        })
      );
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }
}

// Re-embed a brain *in place* under new embedding settings.
//
// A Bedrock KB's embedding model and its S3 Vectors index dimension are
// immutable, so we can't mutate them — but we keep the brain row (id, bearer
// token, connectors, suggestions, MCP URL) completely stable and only swap the
// underlying KB/index/bucket beneath it:
//
//   1. Provision a fresh KB/index/bucket under a generation-salted name (the
//      current ones keep serving queries the whole time — zero downtime).
//   2. Copy the brain's docs into the new bucket.
//   3. Atomically repoint the row's resource handles + embedding columns.
//   4. Start ingestion so the copied content is embedded with the new model.
//   5. Tear down the brain's previous resources (skipped for CDK-managed ones,
//      e.g. the default brain).
//
// The brain id, bearer token secret, and MCP URL never change — externally
// configured MCP clients keep working untouched.
async function reembedBrain(event) {
  const brainId = event.brain_id;
  if (!brainId) throw new Error("brain_id is required");
  const embedding = resolveEmbedding(event);

  const row = await pgFetchOne(
    DATABASE_URL,
    `select id, org_id, status, docs_bucket, kb_id, ds_id, vector_index_arn
       from brains where id = $1`,
    [brainId]
  );
  if (!row) throw new Error(`brain ${brainId} not found`);
  if (event.org_id && row.org_id !== event.org_id) {
    throw new Error("brain belongs to a different org");
  }
  if (row.status !== "ready") {
    throw new Error(`brain ${brainId} is ${row.status}, not ready`);
  }

  const old = {
    bucket: row.docs_bucket,
    kbId: row.kb_id,
    dsId: row.ds_id,
    indexName: indexNameFromArn(row.vector_index_arn),
  };

  // Generation salt — distinguishes the new resource names from the brain's
  // current ones (which still exist and keep serving until the swap).
  const gen = randomBytes(4).toString("hex");
  const newBucket = bucketName(brainId, gen);
  const newIdxName = indexName(brainId, gen);
  const newIdxArn = indexArnForName(newIdxName);

  let newKb;
  let newDs;
  try {
    // 1. Provision the new resource set.
    await createBrainBucket(newBucket);
    await wireAutoIngestNotification(newBucket);
    await createVectorIndex(newIdxName, embedding.dimensions);
    newKb = await createBrainKb(
      `context101-brain-${brainId}-${gen}`,
      embedding.modelArn,
      embedding.dimensions,
      newIdxArn,
      embedding.configurableDims
    );
    newDs = await createBrainDataSource(newKb, newBucket, embedding.chunking);

    // 2. Copy the brain's docs into the new bucket. The registry still points
    //    at the OLD bucket, so auto-ingest ignores these PutObject events; we
    //    trigger embedding explicitly after the swap.
    if (old.bucket) {
      const n = await copyBucketContents(old.bucket, newBucket);
      console.log(`[brain=${brainId}] re-embed copied ${n} object(s)`);
    }
  } catch (err) {
    // Provisioning failed before the swap — the brain still points at its
    // intact original resources. Best-effort clean up the partial new set.
    console.error(`re-embed provisioning failed for ${brainId}:`, err);
    await teardownResources({
      bucket: newBucket,
      kbId: newKb,
      dsId: newDs,
      indexName: newIdxName,
    }).catch((e) => console.warn("partial cleanup failed:", e.message));
    throw err;
  }

  // 3. Atomically repoint the brain to the new resources + embedding settings.
  //    id / token_secret_arn / connectors / suggestions are all untouched.
  await pgExecute(
    DATABASE_URL,
    `update brains
       set docs_bucket = $2,
           vector_index_arn = $3,
           kb_id = $4,
           ds_id = $5,
           embedding_model_provider = $6,
           embedding_model_id = $7,
           embedding_model_arn = $8,
           embedding_dimensions = $9,
           embedding_chunking = $10,
           error_msg = null,
           updated_at = now()
     where id = $1`,
    [
      brainId,
      newBucket,
      newIdxArn,
      newKb,
      newDs,
      embedding.provider,
      embedding.modelId,
      embedding.modelArn,
      embedding.dimensions,
      embedding.chunking,
    ]
  );

  // 4. Embed the copied content under the new model/chunking.
  await startIngestion(newKb, newDs);

  // 5. Dispose of the brain's previous resources (no-op for CDK-managed ones).
  try {
    await teardownResources(old);
  } catch (e) {
    console.warn(`old-resource teardown after re-embed failed for ${brainId}:`, e.message);
  }

  return { ok: true, brain_id: brainId, kb_id: newKb, ds_id: newDs };
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
    `select id, docs_bucket, kb_id, ds_id, vector_index_arn from brains where id = $1`,
    [brain_id]
  );
  if (!row) {
    return { ok: true, alreadyGone: true };
  }

  await setBrainStatus(brain_id, "deleting", null);

  // Tear down the brain's resources. Use the *stored* index name (an
  // in-place re-embed may have moved the brain to a generation-salted index
  // that differs from the id-derived default), falling back to the derived
  // name for older rows that predate vector_index_arn.
  await teardownResources({
    bucket: row.docs_bucket,
    kbId: row.kb_id,
    dsId: row.ds_id,
    indexName: indexNameFromArn(row.vector_index_arn) || indexName(brain_id),
  });

  // Delete the bearer token secret (force, no recovery window).
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
  if (action === "reembed") return await reembedBrain(event);
  if (action === "delete") return await deleteBrain(event);
  throw new Error(`unknown action: ${action}`);
};
