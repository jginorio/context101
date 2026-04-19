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
├── upload.py                     # Syncs knowledge/ → S3 docs bucket
├── Dockerfile                    # Used by App Runner
├── knowledge/                    # Your markdown — source of truth
└── requirements.txt
```

## Setup

### 1. Deploy the AWS infrastructure

```bash
cd cdk
npm install

# First time only: bootstrap CDK in your account/region
AWS_PROFILE=plateapr.com npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1

# Deploy — pass -c token=<value> to also provision the App Runner MCP service.
# Omit it during initial development to just stand up the KB/S3 infra.
AWS_PROFILE=plateapr.com npx cdk deploy -c token=<your-shared-bearer-token>
```

Outputs include:
- `DocsBucketName` — where to upload your markdown
- `KnowledgeBaseId` — set as `KB_ID` env var
- `McpUrl` — the App Runner URL (only shown if `-c token=...` was passed)

### 2. Upload your knowledge

```bash
AWS_PROFILE=plateapr.com DOCS_BUCKET=<DocsBucketName> python upload.py
```

Or directly with the CLI:

```bash
aws s3 sync knowledge/ s3://<DocsBucketName>/ --profile plateapr.com
```

The auto-ingest Lambda triggers a Bedrock ingestion job. Wait ~1-3 min for indexing (check the KB status in the AWS console).

### 3a. Run locally for dev

Without a bearer token — no auth, anyone on your machine can hit it:

```bash
pip install -r requirements.txt

export AWS_PROFILE=plateapr.com
export AWS_REGION=us-east-1
export KB_ID=<KnowledgeBaseId>
export DOCS_BUCKET=<DocsBucketName>

fastmcp run server.py:mcp --transport streamable-http --port 8787
```

### 3b. Use the deployed App Runner service (team)

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

**Claude Desktop** — use `fastmcp install` to generate a local stdio proxy that forwards to the App Runner service with auth. See [FastMCP proxy docs](https://gofastmcp.com/integrations/claude-desktop).

## Daily Workflow

1. Edit a markdown file in `knowledge/` (or directly in the S3 console).
2. Upload: `python upload.py` (or `aws s3 sync`).
3. Wait ~1 min for ingestion.
4. Everyone on the team sees the new knowledge immediately.

## Tools

| Tool | Purpose |
|------|---------|
| `search_knowledge(query, limit=5)` | Semantic search — returns ranked chunks with source + score |
| `read_knowledge(s3_key)` | Full content of a source doc |
| `list_sources()` | Enumerate all documents currently in the KB |

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
- The MCP server doesn't write to the KB — documents are managed via S3 (console, CLI, or `upload.py`).
- Each S3 upload triggers a full ingestion job. Bedrock handles dedup/delta indexing internally.
- To rotate the bearer token: re-run `cdk deploy -c token=<new-value>`. Redeploys the App Runner service with the new secret.
