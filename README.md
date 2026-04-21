# Context101 🧠

A shared team knowledge base exposed via MCP, backed by **Amazon Bedrock Knowledge Bases** with S3 + S3 Vectors, and optionally hosted on **AWS App Runner** with bearer-token auth.

Drop markdown files in an S3 bucket, and any MCP client (Claude Desktop, Cursor, Claude Code, Devin) can semantically search them.

## Architecture

```
┌──────────────┐  ┌──────────┐  ┌─────────────┐
│ Claude       │  │  Cursor  │  │ Claude Code │  ...
└──────┬───────┘  └────┬─────┘  └──────┬──────┘
       │               │               │
       └────────[Bearer token]─────────┘
                       ▼
            ┌─────────────────────┐
            │  App Runner         │  ← TLS, stable URL
            │  FastMCP container  │
            └──────────┬──────────┘
              IAM instance role
                       │
          ┌────────────┼────────────┐
          ▼                         ▼
   Bedrock KB (Retrieve)     S3 docs bucket
          │                        │
    Titan embed v2        (markdown, versioned)
          │                        │
          ▼                        ▼
     S3 Vectors            Lambda auto-ingest
      (1024-dim)                on PutObject
```

## Repo Layout

```
.
├── cdk/                          # TypeScript CDK — all AWS infra
│   ├── bin/context101.ts
│   ├── lib/context101-stack.ts
│   └── lambda/auto-ingest/       # S3 event → StartIngestionJob
├── server.py                     # Python MCP server (FastMCP + boto3)
├── Dockerfile                    # Used by App Runner
├── knowledge/                    # Your markdown — source of truth
└── requirements.txt
```

## Setup

### 1. Deploy everything

```bash
cd cdk
npm install

# First time only: bootstrap CDK in your account/region
AWS_PROFILE=plateapr.com npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1

# Deploy — pass -c token=<value> to also provision the App Runner MCP service.
# Omit it during initial development to just stand up the KB/S3 infra.
AWS_PROFILE=plateapr.com npx cdk deploy -c token=<your-shared-bearer-token>
```

`cdk deploy` provisions the infra **and** syncs the local `knowledge/` folder into the S3 docs bucket in one step. The auto-ingest Lambda then kicks off a Bedrock ingestion job. Wait ~1-3 min for indexing (check the KB status in the AWS console).

Outputs:
- `DocsBucketName` — the S3 bucket holding your markdown
- `KnowledgeBaseId` — set as `KB_ID` env var
- `McpUrl` — the App Runner URL (only shown if `-c token=...` was passed)

> **Source of truth:** The local `knowledge/` folder drives the S3 bucket contents on every `cdk deploy`. Files deleted locally are removed from S3. Don't edit files directly in the S3 console — they'll be overwritten on the next deploy. Edit markdown locally, commit to Git, run `cdk deploy`.

### 2a. Run locally for dev

Without a bearer token — no auth, anyone on your machine can hit it:

```bash
pip install -r requirements.txt

export AWS_PROFILE=plateapr.com
export AWS_REGION=us-east-1
export KB_ID=<KnowledgeBaseId>
export DOCS_BUCKET=<DocsBucketName>

fastmcp run server.py:mcp --transport streamable-http --port 8787
```

### 2b. Use the deployed App Runner service (team)

Once deployed with `-c token=<value>`, teammates point their MCP client at `McpUrl` and add the `Authorization: Bearer <token>` header.

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "context101": {
      "url": "https://<McpUrl>/mcp",
      "headers": {
        "Authorization": "Bearer <your-shared-token>"
      }
    }
  }
}
```

**Claude Desktop** — Claude Desktop only speaks MCP over stdio, so use `mcp-remote` as a local proxy that forwards to the streamable-HTTP URL with the auth header. Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "context101": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://<McpUrl>/mcp",
        "--header",
        "Authorization: Bearer <your-shared-token>"
      ]
    }
  }
}
```

Restart Claude Desktop and Context101 should appear in the tools list. The `-y` lets `npx` auto-install `mcp-remote` the first time.

## Inviting teammates to the web app

The web admin UI is gated by Cognito. Self-signup is off by design — you invite people explicitly. Each invite sends an email with a one-time temp password; on first login they set a real one.

Share this URL with teammates: **https://main.dxnsray95mqcv.amplifyapp.com**

### Invite a teammate (copy-paste)

```bash
aws cognito-idp admin-create-user \
  --user-pool-id us-east-1_QsP1U4XHv \
  --username TEAMMATE_EMAIL \
  --user-attributes Name=email,Value=TEAMMATE_EMAIL Name=email_verified,Value=true \
  --profile plateapr.com --region us-east-1
```

Replace `TEAMMATE_EMAIL` (both places) with their actual email. They'll get an email titled "Your temporary password" from `no-reply@verificationemail.com`.

### Revoke access

```bash
aws cognito-idp admin-delete-user \
  --user-pool-id us-east-1_QsP1U4XHv \
  --username TEAMMATE_EMAIL \
  --profile plateapr.com --region us-east-1
```

### If you ever redeploy the stack from scratch

The pool ID above is for this specific deployment. On a fresh deploy, find the new pool with:

```bash
aws cognito-idp list-user-pools --max-results 20 --profile plateapr.com --region us-east-1 \
  --query 'UserPools[?contains(Name, `amplifyAuthUserPool`)].[Id,Name,CreationDate]' \
  --output table
```

### Separate from the MCP bearer token

Note: the Cognito accounts control access to the **web admin UI**. The **MCP endpoint** uses a separate shared bearer token (set at `cdk deploy -c token=...`). Rotating one doesn't affect the other. To rotate the MCP token: re-deploy with a new `-c token=...` value and redistribute to teammates' MCP client configs.

## Daily Workflow

1. Edit a markdown file in `knowledge/` locally.
2. `AWS_PROFILE=plateapr.com npx cdk deploy -c token=<your-token>` from the `cdk/` dir.
3. Wait ~1 min for ingestion.
4. Everyone on the team sees the new knowledge immediately.

On re-deploys, CDK's `BucketDeployment` only uploads files that changed and `prune: true` removes files you deleted locally. No infra changes → quick deploy (~20s).

## Tools

| Tool | Purpose |
|------|---------|
| `search_knowledge(query, limit=5)` | Semantic search — returns ranked chunks with source + score |
| `read_knowledge(s3_key)` | Full content of a source doc |
| `list_sources()` | Enumerate all documents currently in the KB |

## Improve with AI (web app)

Open any `.md` file in the admin UI and click **Improve**. The current document goes to **Claude Opus 4.7 via Amazon Bedrock** (`us.anthropic.claude-opus-4-7`), which returns a rewritten version alongside a summary of what changed. You see a side-by-side diff and choose **Accept & save** or **Cancel**.

The system prompt constrains the model to:
- **Never invent facts, IDs, URLs, schema details, or technical terms** — preserve every concrete value from the original
- Keep the author's voice; don't formalize or casualize
- Keep markdown valid (GFM, fenced code blocks, heading hierarchy)
- Allowed: fix typos, split long paragraphs, clarify headings, convert prose ↔ lists/tables where it improves scannability, rewrite ambiguous sentences, add a one-line opening summary if missing

Cost: ~$0.02–0.05 per call on a typical 10KB doc. Nothing is written to S3 unless you Accept.

**Requires on the AWS account:**
- Bedrock model access granted for Claude Opus 4.7 (one-time: `aws bedrock create-foundation-model-agreement`)
- `bedrock:InvokeModel` + `aws-marketplace:*` on the Amplify SSR compute role (handled by CDK)

## How it works under the hood

### Ingestion: markdown → vectors

```
knowledge/databases.md                   (local markdown)
         │
         │  cdk deploy (BucketDeployment)
         ▼
┌─────────────────────────┐
│  S3 docs bucket         │  ← versioned
└────────────┬────────────┘
             │  S3 PutObject event
             ▼
┌─────────────────────────┐
│  Auto-ingest Lambda     │
│  StartIngestionJob      │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Bedrock KB ingestion   │
│                         │
│  1. Parse markdown      │
│  2. Chunk the doc       │  ← default: fixed-size ~300 tokens
│                         │    with 20% overlap between chunks
│  3. Embed each chunk    │  ← Titan embed v2 → float32[1024]
│  4. Write to index      │
└────────────┬────────────┘
             │
             ▼
    ┌────────┐ ┌────────┐ ┌────────┐
    │chunk 1 │ │chunk 2 │ │chunk 3 │  …
    │vec+meta│ │vec+meta│ │vec+meta│
    └────────┘ └────────┘ └────────┘
         (stored in S3 Vectors)
```

**Why 20% overlap?** So a question whose answer spans a chunk boundary still retrieves a chunk that contains the full answer.

**Why non-filterable metadata?** S3 Vectors caps **filterable** metadata at 2KB/vector. Bedrock stores the raw chunk text under `AMAZON_BEDROCK_TEXT` — which for documents with long chunks would blow past the cap. We mark that key (and `AMAZON_BEDROCK_METADATA`) non-filterable so they don't count against the cap. They're still retrievable — you just can't use them as filter predicates.

### Retrieval: query → top-K chunks

```
"how do I query amplia listings?"
            │
            │  search_knowledge(query, limit=5)
            ▼
┌─────────────────────────┐
│  MCP server (FastMCP)   │
│  calls bedrock:Retrieve │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Titan embed v2         │  query → float32[1024]
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  S3 Vectors             │
│  cosine top-K search    │  ← over all chunk vectors
└────────────┬────────────┘
             │
             ▼
   top-K chunks, each with:
     • text      (the chunk content)
     • s3 uri    (source doc)
     • score     (0.0 – 1.0)
             │
             ▼
   agent may call read_knowledge(key)
   if it needs the full source doc
```

## Cleanup

```bash
cd cdk
AWS_PROFILE=plateapr.com npx cdk destroy
```

The S3 docs bucket and S3 Vectors bucket have `RETAIN` policies — you won't lose data. Empty them manually if you want them gone.

## Why this stack

- **S3 Vectors** — cheapest vector store option; stays inside S3.
- **Titan embed v2, 1024-dim** — native to Bedrock, no third-party API keys.
- **App Runner** — stable TLS URL, simple container hosting, ~$5-15/mo. No per-seat pricing.
- **Shared bearer token** — honest threat model for a small team. Graduate to Cognito per-user auth later if needed.
- **IAM instance role** — the MCP never holds AWS access keys; permissions flow through the App Runner role.

## Notes

- `removalPolicy: RETAIN` on docs and vector buckets — accidental `cdk destroy` won't wipe your data.
- The MCP server doesn't write to the KB — documents are managed via the `knowledge/` folder + `cdk deploy`.
- Each S3 upload triggers a full ingestion job. Bedrock handles dedup/delta indexing internally.
- To rotate the bearer token: re-run `cdk deploy -c token=<new-value>`. Redeploys the App Runner service with the new secret.

## Roadmap / TODO

### Metadata sidecars for filtered retrieval

Bedrock KB supports per-document metadata via `.metadata.json` sidecar files alongside each doc in S3. This lets agents filter results by attributes — e.g. "only Platea docs" or "only docs updated after April".

```
knowledge/
├── databases.md
├── databases.md.metadata.json          ← sidecar
│     {
│       "metadataAttributes": {
│         "team":    "platea",
│         "source":  "notion",
│         "updated": "2026-04-18"
│       }
│     }
├── domain-knowledge/amplia.md
└── domain-knowledge/amplia.md.metadata.json
```

At query time, the MCP would accept a filter:

```
search_knowledge(
  query  = "pricing strategy",
  filter = { equals: { key: "team", value: "platea" } }
)
         │
         ▼
┌─────────────────────────┐
│  bedrock:Retrieve with  │  ← Bedrock translates the filter
│  filter expression      │    into an S3 Vectors metadata
└────────────┬────────────┘    filter on the search
             │
             ▼
   Only chunks from docs whose sidecar
   has { team: "platea" } are returned
```

**To enable this:**
1. Write sidecar files (manually, or auto-generate from markdown frontmatter).
2. Extend `search_knowledge` to accept an optional `filter` arg and pass it through to `bedrock:Retrieve`.
3. No Index config change needed — custom attributes from sidecars default to filterable, subject to the 2KB-per-vector cap. For short string values this is fine.

**When it's worth adding:**
- Multiple distinct knowledge domains in one KB and you want queries scoped to one.
- Freshness filtering (e.g. "exclude anything older than 6 months").
- Per-audience views (engineering-only docs vs shared team docs).

### Other ideas

- **Per-folder descriptions** — drop a `_about.md` in each folder that explains what the folder is for ("use knowledge in here when solving anything database-related"). Bedrock indexes it like any other markdown so semantic search picks it up naturally. The web UI would filter `_about.md` out of the normal list and show its content under the folder name, Devin-style. Stronger variant: wire `customTransformationConfiguration` on `CfnDataSource` to a Lambda that prepends the folder context to every file at ingestion time, so every chunk's vector carries the folder context.
- **Hierarchical or semantic chunking** — better retrieval on long, structured docs. Higher ingestion cost. Swap the `chunkingConfiguration` on `CfnDataSource`.
- **Per-user auth via Cognito + JWT** — graduate from the shared bearer token when you need per-person audit trails. Swap `StaticTokenVerifier` for FastMCP's `JWTVerifier` pointing at a Cognito user pool.
- **Multimodal ingestion** — Bedrock KB supports images and tables via `SupplementalDataStorageLocation`. Worth it if team knowledge ever includes diagrams/screenshots.
- **Migrate App Runner → ECS Express Mode** — AWS announced April 30, 2026 that App Runner is closed to new customers. Existing services (ours) keep working indefinitely, but no new features are planned. AWS's recommended successor is [ECS Express Mode](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html). Hold off until (a) AWS announces an actual App Runner EOL date, or (b) ECS Express Mode has been GA long enough to be battle-tested. At our scale the migration would also add ALB costs (~$16/mo minimum) on top of existing Fargate charges.
