# Team Brain 🧠

A shared team knowledge base exposed via MCP, backed by **Amazon Bedrock Knowledge Bases** with S3 + S3 Vectors.

Everyone's AI tools connect to the same brain. Drop markdown files in an S3 bucket, and any MCP client (Claude Desktop, Cursor, Claude Code, Devin) can semantically search them.

## Architecture

```
┌──────────────┐  ┌──────────┐  ┌─────────────┐  ┌───────────────┐
│ Claude       │  │  Cursor  │  │ Claude Code │  │    Devin      │
│ Desktop      │  │          │  │             │  │               │
└──────┬───────┘  └────┬─────┘  └──────┬──────┘  └───────┬───────┘
       │               │               │                 │
       └───────────────┴───────┬───────┴─────────────────┘
                               │ MCP (streamable HTTP)
                               ▼
                    ┌──────────────────────┐
                    │   MCP Server (Py)    │
                    │   search_knowledge   │
                    │   read_knowledge     │
                    │   list_sources       │
                    └──────────┬───────────┘
                               │ bedrock-agent-runtime:Retrieve
                               ▼
       ┌───────────────────────────────────────────────┐
       │         Bedrock Knowledge Base                │
       │  (Titan embed v2, 1024-dim, cosine)           │
       └────────────┬──────────────────────┬───────────┘
                    │                      │
             S3 (docs, markdown)    S3 Vectors (index)
                    │
                    └─── Lambda auto-ingest on PutObject
```

## Repo Layout

```
.
├── cdk/                      # TypeScript CDK — provisions all AWS infra
│   ├── bin/team-brain.ts
│   ├── lib/team-brain-stack.ts
│   └── lambda/auto-ingest/   # S3 event → StartIngestionJob
├── server.py                 # Python MCP server (FastMCP + boto3)
├── upload.py                 # Syncs knowledge/ → S3 docs bucket
├── knowledge/                # Your markdown — source of truth
│   ├── general-knowledge.md
│   ├── databases.md
│   └── domain-knowledge/
└── requirements.txt
```

## Setup

### 1. Deploy the AWS infrastructure

```bash
cd cdk
npm install

# First time only: bootstrap CDK in your account/region
AWS_PROFILE=plateapr.com npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1

# Deploy
AWS_PROFILE=plateapr.com npx cdk deploy
```

The outputs will include:
- `DocsBucketName` — where to upload your markdown
- `KnowledgeBaseId` — set as `KB_ID` env var for the MCP server

### 2. Upload your knowledge

```bash
# From the repo root
AWS_PROFILE=plateapr.com DOCS_BUCKET=<DocsBucketName> python upload.py
```

Or use the AWS CLI directly:

```bash
aws s3 sync knowledge/ s3://<DocsBucketName>/ --profile plateapr.com
```

Either way, the auto-ingest Lambda triggers a Bedrock ingestion job. Wait ~1-3 min for indexing to finish (check the KB status in the AWS console).

### 3. Run the MCP server

```bash
pip install -r requirements.txt

export AWS_PROFILE=plateapr.com
export AWS_REGION=us-east-1
export KB_ID=<KnowledgeBaseId>
export DOCS_BUCKET=<DocsBucketName>

fastmcp run server.py:mcp --transport streamable-http --port 8787
```

### 4. Connect MCP clients

Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "team-brain": {
      "url": "http://localhost:8787/mcp"
    }
  }
}
```

Claude Desktop — install via FastMCP CLI so STDIO transport with the right env vars is wired up:

```bash
fastmcp install claude-desktop server.py:mcp \
  --name team-brain \
  --with boto3 \
  --env AWS_PROFILE=plateapr.com \
  --env AWS_REGION=us-east-1 \
  --env KB_ID=<KnowledgeBaseId> \
  --env DOCS_BUCKET=<DocsBucketName>
```

## Daily Workflow

1. Edit a markdown file in `knowledge/` (or directly in the S3 console).
2. Upload: `python upload.py` (or `aws s3 sync`).
3. Wait ~1 min for ingestion.
4. Your agents see the new knowledge immediately.

## Tools

| Tool | Purpose |
|------|---------|
| `search_knowledge(query, limit=5)` | Semantic search — returns ranked chunks with source + score |
| `read_knowledge(s3_key)` | Full content of a source doc (e.g. after search surfaces a chunk) |
| `list_sources()` | Enumerate all documents currently in the KB |

## Cleanup

```bash
cd cdk
AWS_PROFILE=plateapr.com npx cdk destroy
```

The S3 docs bucket and S3 Vectors bucket have `RETAIN` policies — they won't be deleted automatically. Empty them manually first if you want them gone.

## Why this stack

- **S3 Vectors** — cheapest vector store option; stays inside S3. Good for PoC scale.
- **Titan embed v2, 1024-dim** — native to Bedrock, no third-party API keys.
- **CDK L1 for S3 Vectors** — no L2 constructs exist yet for this new service; L1 is fine and stable.
- **Auto-ingest Lambda** — no manual "click Sync" after every upload.

## Notes

- `removalPolicy: RETAIN` on the docs and vector buckets — you won't lose data if the stack is destroyed by accident.
- The MCP server doesn't write to the KB — documents are managed via S3 (console, CLI, or `upload.py`). If you want a `store_knowledge` tool that writes to S3, easy to add later.
- Each S3 upload triggers a full ingestion job. Bedrock handles dedup/delta indexing internally.
