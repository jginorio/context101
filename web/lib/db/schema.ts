import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const brainStatus = pgEnum("brain_status", [
  "provisioning",
  "ready",
  "error",
  "deleting",
]);
export const suggestionStatus = pgEnum("suggestion_status", [
  "pending",
  "accepted",
  "rejected",
]);
export const sourceType = pgEnum("source_type", [
  "sheets",
  "docs",
  "slides",
  "notion",
  "github",
  "manual",
]);
export const sourceStatus = pgEnum("source_status", [
  "pending_auth",
  "syncing",
  "connected",
  "error",
  "paused",
]);
export const mcpTokenRole = pgEnum("mcp_token_role", [
  "read",
  "read_suggest",
  "admin",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

// Better Auth owns auth, organization, membership, and invitation tables.
// Context101 app tables store Better Auth organization/user IDs as plain text
// so the app schema can stay independent from Better Auth's generated schema.

export const brains = pgTable(
  "brains",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    systemPrompt: text("system_prompt"),
    status: brainStatus("status").notNull().default("provisioning"),
    errorMsg: text("error_msg"),
    kbId: text("kb_id"),
    dsId: text("ds_id"),
    docsBucket: text("docs_bucket"),
    vectorIndexArn: text("vector_index_arn"),
    tokenSecretArn: text("token_secret_arn"),
    // Wiki generation model. null provider = default AWS Bedrock (keyless,
    // via the wiki task role). For bring-your-own providers (anthropic,
    // openai, grok, gemini) the API key lives in Secrets Manager and only
    // its ARN is stored here.
    wikiModelProvider: text("wiki_model_provider"),
    wikiModelId: text("wiki_model_id"),
    wikiLlmKeySecretArn: text("wiki_llm_key_secret_arn"),
    // Embedding model the brain's Bedrock KB + S3 Vectors index were built
    // with. Baked in at provision time and immutable for a given brain —
    // changing embeddings means provisioning a replacement brain (see
    // `source_brain_id` / `replaced_by_brain_id`). provider is "aws" |
    // "cohere"; the chunking strategy + params live in `embedding_chunking`
    // JSON and are only meaningful for Cohere (Bedrock-managed default
    // otherwise).
    embeddingModelProvider: text("embedding_model_provider"),
    embeddingModelId: text("embedding_model_id"),
    embeddingModelArn: text("embedding_model_arn"),
    embeddingDimensions: integer("embedding_dimensions"),
    embeddingChunking: jsonb("embedding_chunking"),
    // Replacement lineage: when a brain is created to re-embed another
    // brain's content under new settings, `source_brain_id` points back to
    // the original and the original's `replaced_by_brain_id` points forward.
    sourceBrainId: text("source_brain_id"),
    replacedByBrainId: text("replaced_by_brain_id"),
    createdBy: text("created_by").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("brains_org_id_id_idx").on(table.orgId, table.id),
    index("brains_org_status_idx").on(table.orgId, table.status),
  ]
);

export const suggestions = pgTable(
  "suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    brainId: text("brain_id")
      .notNull()
      .references(() => brains.id, { onDelete: "cascade" }),
    status: suggestionStatus("status").notNull().default("pending"),
    title: text("title").notNull(),
    content: text("content").notNull(),
    targetPath: text("target_path"),
    finalPath: text("final_path"),
    rationale: text("rationale"),
    trigger: text("trigger"),
    proposedBy: text("proposed_by"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("suggestions_brain_status_idx").on(
      table.brainId,
      table.status,
      table.createdAt
    ),
    index("suggestions_org_status_idx").on(table.orgId, table.status),
  ]
);

export const connectors = pgTable(
  "connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    brainId: text("brain_id")
      .notNull()
      .references(() => brains.id, { onDelete: "cascade" }),
    type: sourceType("type").notNull(),
    label: text("label").notNull(),
    externalUrl: text("external_url"),
    externalId: text("external_id"),
    status: sourceStatus("status").notNull().default("pending_auth"),
    tokenSecretArn: text("token_secret_arn"),
    metadata: jsonb("metadata").notNull().default({}),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    itemCount: integer("item_count"),
    createdBy: text("created_by").notNull(),
    ...timestamps,
  },
  (table) => [
    index("connectors_brain_idx").on(table.brainId),
    index("connectors_org_status_idx").on(table.orgId, table.status),
  ]
);

export const mcpTokens = pgTable(
  "mcp_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    brainId: text("brain_id")
      .notNull()
      .references(() => brains.id, { onDelete: "cascade" }),
    hashedToken: text("hashed_token").notNull().unique(),
    prefix: text("prefix").notNull(),
    role: mcpTokenRole("role").notNull().default("read_suggest"),
    label: text("label"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("mcp_tokens_brain_active_idx").on(table.brainId),
    index("mcp_tokens_lookup_idx").on(table.hashedToken),
  ]
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    orgId: text("org_id").notNull(),
    brainId: text("brain_id"),
    actorId: text("actor_id"),
    actorKind: text("actor_kind").notNull(),
    action: text("action").notNull(),
    targetKind: text("target_kind"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("audit_org_time_idx").on(table.orgId, table.occurredAt)]
);

export const usageMetrics = pgTable(
  "usage_metrics",
  {
    orgId: text("org_id").notNull(),
    date: date("date").notNull(),
    metric: text("metric").notNull(),
    value: bigint("value", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.date, table.metric] }),
    index("usage_metrics_org_date_idx").on(table.orgId, table.date),
  ]
);
