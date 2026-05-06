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
│   └── lambda/
│       ├── auto-ingest/          # S3 event → Bedrock StartIngestionJob
│       ├── start-wiki-gen/       # SSR → ecs:RunTask shim (bypasses the Amplify PassRole deny)
│       ├── connector-dispatch/   # EventBridge 6h → fan-out to per-type sync Lambdas
│       ├── connector-sync-sheets/
│       ├── connector-sync-docs/
│       ├── connector-sync-slides/
│       └── connector-sync-notion/
├── server.py                     # Python MCP server (FastMCP + boto3)
├── Dockerfile                    # Used by App Runner
├── knowledge/                    # Your markdown — source of truth
├── web/                          # Next.js admin UI (Amplify Hosting)
├── wiki-generator/               # Fargate task — synthesizes both the
│                                 # team wiki (WIKI_MODE=main) and the
│                                 # per-repo code wiki (WIKI_MODE=code)
└── requirements.txt
```

## Prerequisites

Before your first deploy, make sure you have:

**Local tooling**
- **AWS CLI v2** authenticated for the target account (`aws sts get-caller-identity` should work). The examples use `AWS_PROFILE=plateapr.com`; replace with your own profile/region.
- **Node 20+** and **npm** — for the CDK app and the Next.js web build.
- **Docker** — CDK asset bundling for the wiki-generator image uses it. `colima start` on macOS if you use Colima.
- **GitHub CLI (`gh`)** or a manually-created Personal Access Token — Amplify Hosting needs a GitHub token with `repo` scope to watch your fork. `gh auth token` returns one if you're already logged in.
- **Python 3.11+** — only if you want to run the MCP server or the wiki generator locally.

**AWS account setup**
- **Region** — everything is wired up for `us-east-1`. It can be changed, but S3 Vectors and the Opus 4.7 cross-region inference profile (`us.anthropic.claude-opus-4-7`) have region caveats; staying in `us-east-1` for the first deploy is the smooth path.
- **CDK bootstrap** — run once per account+region:
  ```bash
  AWS_PROFILE=plateapr.com npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
  ```
- **Bedrock model access** — enable the models we use in the Bedrock console → *Model access*:
  - `amazon.titan-embed-text-v2:0` (embeddings for the KB)
  - `us.anthropic.claude-opus-4-7` (the *Improve with AI* button and the wiki generator — requires a Marketplace subscription, done once via the "Request access" flow)

  Without these, `cdk deploy` will still succeed, but writes to `/improve` and wiki regen will 403.

**GitHub**
- Fork this repo to your own account. CDK references the repo by owner/name inside `lib/context101-stack.ts` — update the `repository` URL there if your fork lives elsewhere.

**(Optional) Provider OAuth clients** — only needed if you plan to use the data connectors. See [Data source connectors](#data-source-connectors) for Google + Notion setup; they're no-ops until you provision their secrets.

## Setup

### 1. First deploy (minimal — just KB + docs bucket)

```bash
cd cdk
npm install
AWS_PROFILE=plateapr.com npx cdk deploy
```

This provisions the baseline infra — S3 docs bucket, Bedrock Knowledge Base, S3 Vectors, DynamoDB tables, all Lambdas — and seeds the docs bucket from the local `knowledge/` folder. The auto-ingest Lambda kicks off a Bedrock ingestion job; wait ~1-3 min (watch the KB in the AWS console).

> **Source of truth:** At runtime, the **S3 docs bucket** is the source of truth. Content is managed through the web admin UI, agent `suggest_knowledge` proposals (reviewed in the Suggestions tab), and data connectors. The local `knowledge/` folder is just a **bootstrap seed** synced on the *initial* `cdk deploy` so a fresh stack isn't empty. Avoid editing files in the S3 console directly — use the web UI so writes go through the app's auth, approval, and audit surfaces.

**Key outputs** (you'll want to save these):
- `DocsBucketName` — the S3 bucket holding your markdown
- `KnowledgeBaseId` — set as `KB_ID` when running the MCP server locally
- `ConnectorsTableName`, `Connector*FnName` — referenced by the web app at runtime

The web admin UI and App Runner MCP service are **gated on two CDK context flags** (they only deploy if you pass them). See the next two sections.

### 2. Deploy the MCP service (App Runner)

Pass a shared bearer token — this is what MCP clients will use to authenticate:

```bash
AWS_PROFILE=plateapr.com npx cdk deploy -c token=<pick-any-long-random-string>
```

`McpUrl` appears in the outputs. Rotating the token later = re-deploy with a new `-c token=` and redistribute the new value to teammates' MCP client configs.

### 3. Deploy the web admin UI (Amplify Hosting)

Amplify needs a GitHub PAT with `repo` scope to clone your fork + subscribe to push events:

```bash
# Using the GitHub CLI (recommended)
GH_PAT=$(gh auth token)

# …or paste one you generated at github.com/settings/tokens

AWS_PROFILE=plateapr.com npx cdk deploy \
  -c token=<your-bearer-token> \
  -c githubToken="$GH_PAT"
```

`WebAppDefaultDomain` in the outputs is the URL to share with teammates (e.g. `https://main.abc123xyz.amplifyapp.com`). The first Amplify build takes ~4 min.

> ⚠️ **Amplify build timing gotcha:** if CDK added new Amplify env vars during *this* deploy, the build that was auto-triggered from the deploy doesn't see them — you need to kick one more build after the deploy finishes:
> ```bash
> aws amplify start-job --app-id <WebAppId> --branch-name main --job-type RELEASE
> ```

### 4. Create your first Cognito user

Cognito is provisioned by Amplify Gen 2 auth on the first web build. Self-signup is off — you invite yourself manually:

```bash
# Find the user pool (fresh deploys get a new one every time the Amplify app is recreated)
POOL_ID=$(aws cognito-idp list-user-pools --max-results 30 \
  --query 'UserPools[?contains(Name, `amplifyAuthUserPool`)] | sort_by(@, &CreationDate)[-1].Id' \
  --output text --profile plateapr.com --region us-east-1)

aws cognito-idp admin-create-user \
  --user-pool-id "$POOL_ID" \
  --username YOUR_EMAIL \
  --user-attributes Name=email,Value=YOUR_EMAIL Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL \
  --profile plateapr.com --region us-east-1
```

Check your inbox for a temp password (from `no-reply@verificationemail.com`). First login at `WebAppDefaultDomain` forces a password reset.

### 5. (Optional) Set up data-source connectors

OAuth client creds live in Secrets Manager. See [Data source connectors](#data-source-connectors) for full per-provider setup. The short version:

```bash
# Google (needed for Sheets/Docs/Slides)
aws secretsmanager create-secret \
  --name context101-google-oauth-client \
  --secret-string '{"client_id":"…","client_secret":"…"}' \
  --region us-east-1

# Notion (needed for Notion connector)
aws secretsmanager create-secret \
  --name context101-notion-oauth-client \
  --secret-string '{"client_id":"…","client_secret":"…"}' \
  --region us-east-1
```

CDK references both secrets by *name*, not value — so rotating the creds doesn't require a redeploy. If a secret doesn't exist yet, that connector's "Add new source" flow returns a clear 500 until it does.

### 6a. Run locally for dev

Without a bearer token — no auth, anyone on your machine can hit it:

```bash
pip install -r requirements.txt

export AWS_PROFILE=plateapr.com
export AWS_REGION=us-east-1
export KB_ID=<KnowledgeBaseId>
export DOCS_BUCKET=<DocsBucketName>

fastmcp run server.py:mcp --transport streamable-http --port 8787
```

### 6b. Use the deployed App Runner service (team)

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

## Onboarding teammates to the MCP servers

The team uses several MCP servers from Claude Desktop / Cursor / Devin: **Context101** (this knowledge base), **Metabase**, **Google Analytics**, **Contentful**, and **Iterable**. Each one has its own toolchain (`uv`/`uvx`, `pipx`, `gcloud`, `nvm`/Node, etc.) and a Claude Desktop config block. AWS Docs and Sentry can be added back to the catalog in `scripts/install-mcps.sh` if your sub-team wants them.

To save teammates 30 minutes of fiddling, there's an interactive installer:

```bash
./scripts/install-mcps.sh        # walks through everything
./scripts/install-mcps.sh --dry-run   # show what would happen, change nothing
./scripts/install-mcps.sh --yes       # accept brew/pipx/etc. installs without confirming
```

It will:

1. Install Homebrew (if missing) → `jq`, `uv`, `pipx`, `gcloud`, `nvm` + Node 20 — only what's missing.
2. Ask, per MCP, whether you want it; collect any tokens / URLs / project IDs needed.
3. Run `gcloud auth application-default login` for the Google Analytics ADC if you opt in.
4. Merge the resulting `mcpServers` blocks into `~/Library/Application Support/Claude/claude_desktop_config.json` (with a timestamped backup of any existing file).

Re-running the script is safe — answer "n" to anything you don't want to touch and it stays untouched. macOS only for v1.

The installer's source of truth for the config snippets is the wiki — it mirrors the docs at [`mcp/aws-docs-mcp.md`](knowledge/mcp/aws-docs-mcp.md), [`mcp/google-analytics-mcp.md`](knowledge/mcp/google-analytics-mcp.md), [`mcp/metabase-mcp.md`](knowledge/mcp/metabase-mcp.md), and [`mcp/uvx.md`](knowledge/mcp/uvx.md).

## Inviting teammates to the web app

The web admin UI is gated by Cognito. Self-signup is off by design — you invite people explicitly. Each invite sends an email with a one-time temp password; on first login they set a real one.

Share the `WebAppDefaultDomain` output from `cdk deploy` with your teammates (e.g. `https://main.dolgu9byu4ct1.amplifyapp.com`).

### Find the current user pool ID

The pool ID changes every time the Amplify app is recreated (e.g. if you destroy the `if (githubToken)` branch and redeploy). Find the latest one:

```bash
POOL_ID=$(aws cognito-idp list-user-pools --max-results 30 \
  --query 'UserPools[?contains(Name, `amplifyAuthUserPool`)] | sort_by(@, &CreationDate)[-1].Id' \
  --output text --profile plateapr.com --region us-east-1)
echo "$POOL_ID"
```

### Invite a teammate

```bash
aws cognito-idp admin-create-user \
  --user-pool-id "$POOL_ID" \
  --username TEAMMATE_EMAIL \
  --user-attributes Name=email,Value=TEAMMATE_EMAIL Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL \
  --profile plateapr.com --region us-east-1
```

Replace `TEAMMATE_EMAIL` (both places) with their actual email. They'll get an email titled "Your temporary password" from `no-reply@verificationemail.com`.

### Revoke access

```bash
aws cognito-idp admin-delete-user \
  --user-pool-id "$POOL_ID" \
  --username TEAMMATE_EMAIL \
  --profile plateapr.com --region us-east-1
```

### Separate from the MCP bearer token

Note: the Cognito accounts control access to the **web admin UI**. The **MCP endpoint** uses a separate shared bearer token (set at `cdk deploy -c token=...`). Rotating one doesn't affect the other. To rotate the MCP token: re-deploy with a new `-c token=...` value and redistribute to teammates' MCP client configs.

## Daily Workflow

The docs bucket is the source of truth at runtime. Content flows in through three paths — none of them require a deploy:

1. **Web admin UI** — the primary surface for humans. Create, edit, rename, move, or delete markdown files; use **Improve with AI** for Opus-assisted rewrites; review and approve incoming agent proposals from the Suggestions tab.
2. **`suggest_knowledge` MCP tool** — agents (Cursor, Claude Desktop, Claude Code, Devin) propose new docs or updates as they work. Proposals land in the review queue; nothing reaches the brain until a human approves. See [Knowledge suggestions](#knowledge-suggestions-web-app).
3. **Data connectors** — pull content automatically from where teams already write it. **Google Sheets, Google Docs, Google Slides, and Notion are live** (OAuth-based, managed from the [Sources tab](#data-source-connectors)); GitHub and chat are still on the roadmap. Each connector writes markdown + sidecars into the bucket on the same auto-ingest pipeline as the other two paths. The wiki then reconciles across sources.

Every S3 write — whichever path it came from — triggers the auto-ingest Lambda, which kicks a Bedrock ingestion job. New content is retrievable via `search_knowledge` within ~1 min once the canonical wiki catches up (next 10h regen, or hit **Refresh now** in the Wiki tab for an immediate re-synthesis).

`cdk deploy` is reserved for **infra changes** (new tools, IAM tweaks, data-source reconfig) and the **initial seed** of the `knowledge/` folder on a fresh stack. It's not part of the content workflow anymore.

## Tools

| Tool | Purpose |
|------|---------|
| `search_knowledge(query, limit=5)` | Semantic search over the **canonical wiki** — returns ranked chunks from synthesized, deduplicated pages (never raw docs) |
| `read_knowledge(s3_key)` | Full content of any document — raw or wiki. The escape hatch to ground truth when you need detail that was compressed out of the canonical view |
| `list_sources()` | Enumerate all documents currently in the docs bucket |
| `suggest_knowledge(title, content, target_path?, rationale?, trigger?)` | Propose a new doc or update an existing one; goes to the review queue — never writes to the brain directly |

### Two-tier retrieval: canonical vs. raw

The knowledge base holds two kinds of documents:

- **Raw sources** under `knowledge/` — what contributors write or what connectors drop in (GitHub, Notion, suggest_knowledge approvals).
- **Wiki pages** under `wiki/` — synthesized, deduplicated pages generated by the Fargate wiki job from the raw corpus. The wiki is the **canonical view**.

`search_knowledge` filters retrieval to wiki chunks only, via a `.metadata.json` sidecar the generator writes alongside each page:

```json
{
  "metadataAttributes": {
    "source":        "wiki",
    "generated_at":  "2026-04-23T14:30:00Z",
    "page_slug":     "payments",
    "source_files":  "knowledge/payments-rfc.md,knowledge/amplia.md"
  }
}
```

Raw docs don't get a sidecar, so they don't match the `source=wiki` equals filter and drop out of retrieval. They stay embedded in the vector index (cheap), but agents only reach them via `read_knowledge(s3_key)` — typically after seeing a canonical chunk cite a raw file in its `Sources: [file]()` footnote or in its `source_files` metadata.

Why this split:
- **No duplicate-retrieval.** Raw and wiki often say similar things. With both embedded and both retrievable, top-K cosine could return near-duplicates that crowd out distinct content.
- **Reconciled answers.** The wiki is the layer where conflicting raw sources get merged into one coherent page. Querying the raw directly bypasses that reconciliation.
- **Traceable.** Every canonical chunk still links back to its raw sources via citations, so verification is a single `read_knowledge` call away.

## Knowledge suggestions (web app)

Agents can propose knowledge via the MCP's `suggest_knowledge` tool. Proposals land in a DynamoDB review queue — **nothing is written to the brain until a human approves**.

```
Agent (Cursor / Claude Desktop / Devin / RV agent)
    │  suggest_knowledge(title, content, target_path?, rationale?, trigger?)
    ▼
MCP (App Runner)
    │  PutItem status=pending
    ▼
DynamoDB: context101-suggestions
    │
    ▼
Web admin UI → /suggestions tab
    │
    ├─ filter by status: pending / accepted / rejected / all
    ├─ click a row → drawer:
    │     ├─ update case  →  side-by-side diff (existing vs proposed)
    │     └─ new doc case →  rendered preview + editable destination path
    └─ ✓ Approve   → writes to S3 → Bedrock auto-ingests → queryable
       ✗ Reject    → marks rejected (kept for audit)
```

### When an agent should call it

- Discovered a new fact or pattern worth preserving
- Caught an inaccuracy in an existing doc
- Found a missing cross-reference
- Has a clearer explanation of something already covered

### What the reviewer sees

- **Trigger** (e.g. *"when querying amplia"*) or the title if no trigger was given
- Content preview + full rationale in the detail drawer
- For **updates**: a diff of the current file vs the proposed replacement, so you can see exactly what would change
- For **new docs**: the rendered markdown + an editable destination path (defaults to a slugified title at root; override with a subfolder like `databases/my-doc.md`)

### Useful to know

- Approving writes the **full proposed content** to S3 — the agent is expected to produce a drop-in replacement, not a patch
- Rejecting doesn't delete the row; it sits in DynamoDB with `status=rejected` for audit
- The DynamoDB table has a GSI on `(status, created_at)` so listing any status bucket stays fast as the queue grows
- Approval triggers the standard S3 → auto-ingest Lambda → Bedrock ingestion pipeline, so approved suggestions are retrievable via `search_knowledge` within ~1 min

## Data source connectors

Connect a **Google Sheet, Doc, Slides deck, Notion page/database, or GitHub repo** from the **Sources** tab. Each connection authenticates once (OAuth for Google/Notion, a Personal Access Token for GitHub) and the credential lives in its own Secrets Manager secret. Sources re-sync every 6 hours. Content lands as markdown under `sources/<type>/<slug>/…` in the docs bucket — same auto-ingest pipeline as everything else, so new/changed content is retrievable via `search_knowledge` within ~1 min of each sync.

### User flow

1. Sign in to the web app, click **Sources** in the header.
2. Click **Add new source** → pick a provider.
3. Paste the URL + a friendly label. For **GitHub**, also paste a Personal Access Token (no OAuth dance — it's stored directly in Secrets Manager). For OAuth providers, click **Connect …**.
4. **OAuth providers:** consent screen → approve (read-only scopes for Google; Notion lets you pick which specific pages the integration can see).
5. You land back on `/sources`. The connector shows `syncing`; the card polls every 5s and flips to `connected` once the first sync finishes.
6. **Added by** shows the Cognito email that created it. **Google account** / **Notion workspace** / **GitHub user** shows which provider identity authenticated. **Sync now** and **Remove** live on each card.

### What each connector does

| Type | API | Rendering | S3 layout |
|------|-----|-----------|-----------|
| **Sheets** | `spreadsheets.get` + `values.get` per tab | One markdown table per tab | `sources/sheets/<spreadsheet-slug>/<tab-slug>.md` |
| **Docs** | `documents.get` | Walks `body.content` → headings, lists, tables | `sources/docs/<doc-slug>/content.md` |
| **Slides** | `presentations.get` | `## Slide N — <title>` + bullets + speaker notes | `sources/slides/<deck-slug>/content.md` |
| **Notion** | `pages.retrieve` or `databases.query` + recursive `blocks.children.list` | Block tree → paragraphs, headings, lists, tables, code, to-dos, callouts | `sources/notion/<workspace-slug>/<page-slug>.md` (one file per page; databases unfold to one file per row) |
| **GitHub** | `git/trees/{branch}?recursive=1` + `git/blobs/{sha}` per file | Markdown passthrough; code wrapped in fenced ```\<lang> blocks. Filters: extension allowlist, path-segment denylist (node_modules/, dist/, .git/, …), 200KB max | `sources/github/<owner-repo-slug>/<path>.md` (one file per repo file, original tree preserved) |

Every file gets a `.metadata.json` sidecar tagged `source=<type>`, `connector_id=<uuid>`, and resource IDs — so the wiki generator and any future per-source filters can trace back to the exact connector.

### Non-native files (uploaded .xlsx/.docx/.pptx)

Files uploaded to Drive but never converted to native Google formats are rejected by the corresponding Google API (the Sheets API won't read an uploaded `.xlsm`, for example). The connector surfaces this as a clear error on the card:

> This looks like an uploaded Excel file (.xlsx/.xlsm/.ods), not a native Google Sheet. In the Sheet, go **File → Save as Google Sheets**, then retry with the new URL.

Same pattern for Docs (Word) and Slides (PowerPoint).

### Under the hood

```
                                ┌──────────────────────────────┐
EventBridge (6h) ──────────────▶│  connector-dispatch Lambda   │
    OR  /api/connectors/sync    │  queries status=connected    │
    (web UI "Sync now")         │  fan-out Invoke per-type     │
                                └──────────────┬───────────────┘
                                               │
       ┌──────────────────┬──────────────────┬──────────────────┬──────────────────┬──────────────────┐
       ▼                  ▼                  ▼                  ▼                  ▼                  │
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐         │
│  sync-sheets │   │  sync-docs   │   │  sync-slides │   │  sync-notion │   │  sync-github │         │
│              │   │              │   │              │   │              │   │              │         │
│ Google OAuth │   │ Google OAuth │   │ Google OAuth │   │ Notion OAuth │   │  PAT (stored │         │
│  (refresh)   │   │  (refresh)   │   │  (refresh)   │   │  (long-lived │   │   directly,  │         │
│              │   │              │   │              │   │   access tok)│   │   no OAuth)  │         │
│ spreadsheets │   │ documents.get│   │ presentations│   │ pages /      │   │ git/trees +  │         │
│ + values × N │   │ → md (tables,│   │ .get → md    │   │ databases +  │   │ git/blobs    │         │
│ → md tables  │   │   lists,     │   │ (title,      │   │ blocks tree  │   │ → md (.md    │         │
│              │   │   headings)  │   │  notes)      │   │ → md         │   │  passthru,   │         │
│              │   │              │   │              │   │              │   │  code fenced)│         │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘         │
       │                  │                  │                  │                  │                  │
       └──────────────────┴──────────────────┴──────────────────┴──────────────────┘                  │
                                              │                                                        │
                                              ▼                                                        │
                       ┌────────────────────────────────────────────┐                                  │
                       │  S3 docs bucket (sources/<type>/…)         │                                  │
                       └──────────────────┬─────────────────────────┘                                  │
                                          │  S3 PutObject                                              │
                                          ▼                                                            │
                                auto-ingest Lambda → Bedrock KB                                        │
                                                                                                       │
                       Optional: when AUTO_TRIGGER_CODE_WIKI=true on sync-github, ────────────────┘
                       a successful sync fires start-wiki-gen → ECS RunTask in
                       code mode → wiki/code/<repo-slug>/. Off by default —
                       see "Per-repo code wikis" below for manual invocation.
```

### OAuth setup (one-time per provider)

Both providers use the same redirect URI pattern:
```
https://<WebAppDefaultDomain>/api/connectors/oauth/callback
```
…where `<WebAppDefaultDomain>` is the Amplify URL from your stack outputs (e.g. `main.abc123.amplifyapp.com`). The callback route derives the public origin from `x-forwarded-host` — so it works on prod without any `APP_BASE_URL` env var, but the exact URL above has to be **registered in each provider's console** before consent will succeed.

#### Google (Sheets / Docs / Slides)

1. **GCP Console → APIs & Services → Credentials** → **+ Create credentials** → **OAuth client ID** → **Web application**.
2. **Authorized JavaScript origins:** `https://main.<amplify-app-id>.amplifyapp.com`
3. **Authorized redirect URIs:** `https://main.<amplify-app-id>.amplifyapp.com/api/connectors/oauth/callback`
4. **APIs & Services → Library** → enable each API you want to use:
   - **Google Sheets API**
   - **Google Docs API**
   - **Google Slides API**
   - **Google Drive API** (used for `drive.metadata.readonly` so we can show titles)
5. **OAuth consent screen** — configure as *Internal* (G Workspace domain) or *External*. For external apps you'll need to submit for verification before going past ~100 users; internal is fine for a single-workspace team.
6. Store the client creds:
   ```bash
   aws secretsmanager create-secret \
     --name context101-google-oauth-client \
     --secret-string '{"client_id":"…apps.googleusercontent.com","client_secret":"GOCSPX-…"}' \
     --region us-east-1
   ```

#### Notion

1. Go to https://www.notion.so/profile/integrations → **Build** (left sidebar) → **Public connections** → **+ New public connection**.
   - **Must be *Public*, not *Internal***. Internal integrations use a static workspace token; only public integrations expose an OAuth client ID / secret.
2. **Basic information** — name it `Context101`, set installation scope. Add an icon if you want.
3. **Capabilities** → check **Read content** only. Uncheck Update / Insert / Comment.
4. **OAuth Domain & URIs** → add:
   - **Redirect URI:** `https://main.<amplify-app-id>.amplifyapp.com/api/connectors/oauth/callback`
5. Grab the **OAuth client ID** (UUID, e.g. `34cd872b-594c-81eb-…`) and **OAuth client secret** (starts with `secret_…` or `ntn_…`) from the same page.
6. Store the creds:
   ```bash
   aws secretsmanager create-secret \
     --name context101-notion-oauth-client \
     --secret-string '{"client_id":"<UUID>","client_secret":"secret_…"}' \
     --region us-east-1
   ```

CDK references both secrets by *name* (`secretsmanager.Secret.fromSecretNameV2`), so you can rotate values without re-running `cdk deploy`. Add a new JSON version and the next sync picks it up.

#### GitHub (no OAuth — Personal Access Token)

The GitHub connector skips the OAuth dance entirely. When you click **Add new source → GitHub**, the dialog asks for a PAT directly; it's stored in the per-connector secret (`context101-connector-<uuid>`) like every other token, just shaped as `{ "github_pat": "…" }` instead of `{ "refresh_token": "…" }` or `{ "access_token": "…" }`.

Generate the token at https://github.com/settings/tokens. Two flavors work:

- **Fine-grained** (recommended) — pick *Only select repositories*, choose the repos you want to sync, and grant **Repository → Contents: Read-only**. Tied to specific repos, expires on a schedule you set.
- **Classic** — `repo` scope (private repos) or `public_repo` (public only). Broader access; lasts until manually revoked.

Avoid pasting `gho_…` tokens emitted by `gh auth token` — those are the gh CLI's OAuth tokens and rotate when gh refreshes them, breaking the connector with 401s the next time it tries to sync.

### Notion auth model vs Google

A practical quirk: **Google returns a refresh token** (access tokens expire every hour, we refresh on each sync), while **Notion returns a long-lived access token** (no expiry, no refresh flow). Both land in the same per-connector secret (`context101-connector-<uuid>`) but with different shapes:

```jsonc
// Google connector secret
{ "refresh_token": "1//0g…" }

// Notion connector secret
{
  "access_token":   "ntn_…",
  "workspace_id":   "…",
  "workspace_name": "FinditPR",
  "bot_id":         "…"
}
```

Each sync Lambda knows what to expect — `connector-sync-sheets/docs/slides` refresh the Google token via `oauth2.googleapis.com/token`, `connector-sync-notion` uses the access_token directly as `Authorization: Bearer …` with `Notion-Version: 2022-06-28`.

### Connector states

| Status | Meaning |
|---|---|
| `pending_auth` | Row created, user hasn't completed Google consent yet |
| `syncing` | Sync Lambda is running |
| `connected` | Last sync succeeded. `last_synced_at`, `item_count`, `resource_title` are populated |
| `error` | Last sync failed. `last_error` shows the message inline on the card |

Connectors in both `connected` and `error` states are retried on every 6h tick — the dispatcher doesn't give up after a single failure.

### Remove a connector

Click the trash icon on the card → confirm. This:
1. Deletes the refresh-token secret (force delete, no recovery window).
2. Deletes every S3 object under `sources/<type>/<slug>/` in the docs bucket.
3. Deletes the connector row from DynamoDB.

Bedrock auto-reindexes on the S3 delete events, so within a minute the content is gone from `search_knowledge` too.

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

## Auto-generated wiki (web app)

Raw contributions to `knowledge/` don't need to be structured — people drop in whatever makes sense for them. A scheduled **Fargate task** reads the whole corpus and synthesizes a cross-referenced wiki (DeepWiki-style) under `wiki/` in the docs bucket. The admin UI's **Wiki** tab renders it read-only with Mermaid diagrams and source citations back to the original markdown.

**User flow:**
1. Sign in and click **Wiki** in the header.
2. Left sidebar lists pages (e.g. "Overview", "System Architecture", "Data Flow"); main pane renders the selected page.
3. Right-side card shows **Last indexed** timestamp and a **Refresh now** button — one click triggers a fresh regen and polls until it finishes (~1-3 min).

The wiki auto-regenerates every 10 hours via an EventBridge schedule. The scheduled runs and the manual button hit the same Fargate task — but the scheduled tick short-circuits when the corpus hasn't moved, while the manual button always forces a fresh regen (see [Skip when nothing changed](#skip-when-nothing-changed) below).

**What gets written to S3:**
- `wiki/<slug>.md` — one page per topic, full markdown with Mermaid blocks and `Sources: [file.md]()` citations
- `wiki/<slug>.md.metadata.json` — Bedrock KB sidecar tagging the page `source=wiki` (+ `generated_at`, `page_slug`, `source_files`). This is what `search_knowledge` filters on — see [Two-tier retrieval](#two-tier-retrieval-canonical-vs-raw)
- `wiki/_index.json` — nav order, titles, descriptions, source mappings per page
- `wiki/_meta.json` — timestamps + page/source counts + `corpus_sha` (drives the "Last indexed" badge and the no-change guard described below)

Generated pages land in the same bucket as raw docs and the auto-ingest Lambda picks them up the same way. At retrieval time the `source=wiki` sidecar filter is what separates canonical chunks from raw — **`search_knowledge` only returns wiki pages; raw docs are reachable via `read_knowledge`.**

Cost: ~$0.30–0.80 per full regen (one Opus call for the structure + one per page). Fargate runtime is ~3-5 min at $0.04/hr-ish for a 0.5 vCPU / 1 GB task — negligible compared to the Opus spend.

### Manual-only regen + no-change guard

Wiki regen is **off the schedule by default** to keep Opus spend predictable. The team-wiki EventBridge rule (`WikiGenSchedule`) is created with `enabled: false`, and the GitHub connector's auto-fire after sync is gated on the Lambda env var `AUTO_TRIGGER_CODE_WIKI` (unset by default). So today:

- Team wiki regenerates only when a human clicks **Refresh now** on `/wiki`.
- Code wikis regenerate only via the manual `start-wiki-gen` invoke (see below) or by flipping `AUTO_TRIGGER_CODE_WIKI=true` on `connector-sync-github` and waiting for the next 6h connector tick.

If you want the schedule back, flip `enabled: true` on `WikiGenSchedule` in `cdk/lib/context101-stack.ts`. If you want post-sync code-wiki regen back, set the Lambda env var to `true`. The cost-saving plumbing below stays useful either way:

- Each successful regen records a **corpus fingerprint** in `wiki/_meta.json` — SHA-256 over sorted `(key, ETag)` pairs of every input file. Mode-aware: main mode hashes the whole bucket excluding top-level `wiki/<slug>.md`; code mode hashes `sources/github/<repo-slug>/`. ETags are MD5s S3 already computes server-side, so the hash needs **no body downloads** — one `ListObjectsV2` paginate is enough.
- A run lists the corpus, computes the new fingerprint, reads the old one from `_meta.json`. **Same hash → exit 0 without calling Opus.** A no-op invocation costs ~3-5s of Fargate boot + 1-2 S3 calls; nothing is overwritten.
- The manual **Refresh now** button passes `WIKI_FORCE=1` to the container (via `start-wiki-gen` Lambda → `containerOverrides.environment`), which bypasses the guard. So:
  - **User click** → forced → always regenerates (e.g. when you've edited prompts in `wiki-generator/prompts.py` and want the existing corpus re-synthesized with the new prompt).
  - **Re-enabled schedule / auto-fire** → guarded → no-op when nothing changed.
  - **GitHub-sync invocation** (when auto-fire is on) → unguarded but the corpus literally just changed, so the hash differs and it regenerates. Belt-and-suspenders: the github connector's tree-SHA gate already filters out unchanged-repo invocations one layer up.

Existing `wiki/_meta.json` files without a `corpus_sha` field (pre-rollout state) are treated as "no prior hash → regenerate", so the next run after deploying this populates the field naturally — no backfill needed.

### Single-flight: no duplicate Fargate tasks

Two users clicking **Refresh now** simultaneously, or a user clicking while the 10h tick is mid-flight, won't spawn duplicate tasks. The dispatcher Lambda (`start-wiki-gen`) inspects the wiki cluster via `ecs:ListTasks` + `ecs:DescribeTasks` before each `RunTask`, matching by `WIKI_MODE` and (for code mode) `REPO_FULL_NAME` env overrides. If a matching task is already running or pending, it returns that task's ARN with `alreadyRunning: true` instead of starting a new one — the second clicker attaches to the same regen and watches the same progress.

The frontend leans on the same Lambda for cross-session visibility: on `/wiki` page-mount it issues `GET /api/wiki/refresh?check=1`, which invokes the dispatcher in `checkOnly` mode (same dedup query, no `RunTask`). If a regen is in flight, the page enters the **Regenerating…** state and polls until the task stops — so refreshing the page, opening it from another browser, or a different teammate landing on `/wiki` all converge on the same task ARN. The button stays disabled (no re-trigger) until the regen finishes.

ECS is the source of truth — there's no separate lock store. A crashed task self-heals because it just stops appearing in `ListTasks`; no zombie locks to clear. Race window for two near-simultaneous Lambda invocations seeing "no running task" before either's `RunTask` is visible to `ListTasks` is ~hundreds of ms; acceptable for a UX dedup. If it ever turns into a real problem, an S3 conditional `IfNoneMatch:'*'` lock file is the obvious upgrade.

### Run the generator locally

```bash
cd wiki-generator
pip install -r requirements.txt

AWS_PROFILE=plateapr.com \
AWS_REGION=us-east-1 \
DOCS_BUCKET=<DocsBucketName> \
python generate.py
```

Env knobs (all optional): `WIKI_PREFIX` (default `wiki/`), `MODEL_ID` (default `us.anthropic.claude-opus-4-7`), `MIN_PAGES` / `MAX_PAGES` (default 4 / 8), `CORPUS_PREVIEW_CHARS` (default 600 — how much of each source doc feeds into the structure call), `MAX_TOKENS` (default 8192 per Opus call), `WIKI_FORCE=1` (bypass the corpus-hash guard described above).

Set `WIKI_PREFIX=wiki-preview/` to iterate on prompts without overwriting the live wiki.

## Per-repo code wikis (deepwiki-style)

Connecting a GitHub repo gets you two layers of automatic synthesis:

1. **Layer 1 — code in the team wiki.** `connector-sync-github` writes every code file to `sources/github/<repo-slug>/<path>.md`. The next team-wiki regen reads them as part of the corpus, alongside Notion / Sheets / Docs / Slides — so a top-level page about *"/pricing optimization"* can mention which file the implementation lives in and synthesize across strategy, metrics, and code.
2. **Layer 2 — a dedicated code wiki per repo** at `wiki/code/<repo-slug>/<page>.md`. After every successful sync, `connector-sync-github` fires the same Fargate task that generates the team wiki, but in **code mode** — code-specialized prompts that prioritize architecture, data flow, module diagrams, and configuration. Output is tagged `source=code-wiki` in the sidecar.

```
┌────────────────────────────────────────────────────────────────────────┐
│  Top-level reconciled wiki        wiki/<slug>.md                        │  ← what search_knowledge returns
│  (cites everything below)                                               │
└────────────────────────────────┬───────────────────────────────────────┘
              cites both ▼                  ▼
┌──────────────────────────────────┐  ┌────────────────────────────────┐
│  Per-repo code wiki              │  │  Team raw sources              │
│  wiki/code/<repo-slug>/<page>.md │  │  sources/sheets/…              │
│  source=code-wiki                │  │  sources/docs/…                │
│  (Layer 2 — deepwiki-style)      │  │  sources/slides/…              │
└────────────────┬─────────────────┘  │  sources/notion/…              │
                 │ reads from         └────────────────────────────────┘
                 ▼                                   ▲
┌──────────────────────────────────┐                │
│  Raw GitHub sources              │ ◄──────────────┘  same KB,
│  sources/github/<repo-slug>/…    │   same auto-ingest pipeline
│  (Layer 1 — connector output)    │
└──────────────────────────────────┘
```

### What gets retrieved when

- `search_knowledge(query)` — only returns top-level wiki chunks (`source=wiki`). Code-wiki pages stay in the index but are filtered out so they don't dominate results.
- The team wiki's structure prompt sees `wiki/code/<repo-slug>/<page>.md` files in its corpus, so it can pick them as `relevant_files` and cite them — that's how code understanding propagates up without re-feeding raw code to Opus.
- `read_knowledge(s3_key)` — escape hatch to read a code-wiki page or a raw `sources/github/…` file directly when an agent needs to dive deeper than what the team wiki cited.

### One Fargate task, two modes

`wiki-generator/generate.py` switches behavior on `WIKI_MODE`:

| Env | `main` (default) | `code` |
|---|---|---|
| Corpus | whole bucket, excludes top-level `wiki/<slug>.md` (keeps `wiki/code/…` in scope) | scoped to `CORPUS_PREFIX=sources/github/<repo-slug>/` |
| Output | `wiki/<slug>.md` | `wiki/code/<repo-slug>/<slug>.md` |
| Prompts | `STRUCTURE_PROMPT` + `PAGE_PROMPT` (team docs) | `CODE_STRUCTURE_PROMPT` + `CODE_PAGE_PROMPT` (architecture, data flow, module diagrams) |
| Sidecar `source` | `wiki` | `code-wiki` |

The same `start-wiki-gen` Lambda starts both. SSR `/api/wiki/refresh` invokes it with `{}` for main mode; `connector-sync-github` invokes it with `{ mode: "code", repo: "owner/repo" }` after a sync. `containerOverrides.environment` carries the per-task env diffs.

### Costs + auto-trigger gating

Per code-wiki regen: ~$0.30-0.80 in Opus calls (one structure call + one per page) + ~3-5 min of Fargate at ~$0.04/hr.

By default, **the GitHub connector does not auto-fire code-wiki regens** — the env var `AUTO_TRIGGER_CODE_WIKI` is unset on `connector-sync-github`, and the per-sync code path bails before any Opus call. Code wikis only regenerate when *you* trigger them (via the manual `start-wiki-gen` invoke command below). Sources still sync content into `sources/github/<repo>/` every 6h — only the expensive synthesis is gated.

To opt back into the original auto-regen behavior, set the Lambda env var to `true`:

```bash
aws lambda update-function-configuration \
  --function-name context101-connector-sync-github \
  --environment 'Variables={
    CONNECTORS_TABLE=context101-connectors,
    DOCS_BUCKET=<...>,
    START_WIKI_GEN_FN_NAME=context101-start-wiki-gen,
    AUTO_TRIGGER_CODE_WIKI=true
  }' --region us-east-1
```

(Or set it in CDK and redeploy.) When auto-trigger is on, a tree-SHA cost guard kicks in:

- Each successful github sync records the GitHub **tree SHA** (`row.last_synced_tree_sha` on the connector row) — the SHA of the repo's tree object at HEAD, deterministic from file structure + blob contents.
- The next sync compares against the stored value. **Same SHA → skip the code-wiki dispatch entirely.** Files are still re-PUT to S3 (idempotent, microseconds, restores anything deleted out of band); only the Opus regen is gated.
- The sync's return value includes `tree_changed` and `code_wiki_fired` so you can see what happened in CloudWatch.

Further-down-the-roadmap optimization: cache page-level outputs by `relevant_files` content hash and only regenerate pages whose inputs changed.

### Browsing code wikis in the UI

The `/wiki` page sidebar has two groups:

- **Team wiki** — top-level synthesis under `wiki/<slug>.md` (what `search_knowledge` returns).
- **Code wikis** — one collapsible section per connected GitHub repo. Pages come from `wiki/code/<repo-slug>/_index.json`. Click a repo's name to expand its pages.

Selecting a code-wiki page swaps the right-side meta panel to show that repo's `last_indexed` + page count instead of the team wiki's. The **Refresh now** button is hidden for code wikis today — auto-trigger is off by default (see "Costs + auto-trigger gating" above), so to regenerate a code wiki you invoke `start-wiki-gen` manually with `{ mode: "code", repo: "owner/repo" }`. The next iteration will surface that as a per-repo button in the UI.

Selection state in the URL is **not** persisted today — refreshing the page resets to the first team-wiki page. That's a deliberate v1 simplification, easy follow-up to add deep links later (e.g. `/wiki?repo=foo-bar&slug=architecture`).

### Manually invoking a code-wiki regen

You can trigger a one-off code-wiki run for any connected repo:

```bash
aws lambda invoke \
  --function-name context101-start-wiki-gen \
  --payload '{"mode":"code","repo":"owner/repo"}' \
  --cli-binary-format raw-in-base64-out /dev/stdout \
  --region us-east-1
```

Watch the Fargate task in the AWS console under ECS → `context101-wiki` cluster. It writes to `wiki/code/<owner-repo-slug>/`; pages are retrievable via `read_knowledge` immediately and surface in the next team-wiki regen.

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

### Wiki generation: corpus → synthesized pages

```
                               ┌────────────────────────┐
                               │  EventBridge (10h)     │
    ┌──────────────────────────┤  OR  web UI click      │
    │                          │  → ecs:RunTask         │
    ▼                          └────────────────────────┘
┌──────────────────┐
│  Fargate task    │   (0.5 vCPU, ~3-5 min)
│  generate.py     │
└────────┬─────────┘
         │
         │  1. List s3://docs/ *.md (excluding wiki/)
         │  2. Build corpus summary (filename + preview)
         │
         ▼
┌──────────────────────┐
│  Opus call #1        │  ← structure prompt
│  "plan the wiki"     │    returns <wiki_structure> XML:
└────────┬─────────────┘    { pages: [{title, description,
         │                     relevant_files, related}] }
         │
         │  3. Parse XML → list of page specs
         │
         ▼
┌──────────────────────┐
│  Opus call per page  │  ← per-page prompt + relevant source MDs
│  "write the page"    │    returns markdown with Mermaid blocks
└────────┬─────────────┘    and Sources: [file.md]() citations
         │
         │  4. Write each generated page + _index.json + _meta.json
         │
         ▼
┌──────────────────────┐
│  S3 docs bucket      │
│  wiki/*.md           │  ← the artifact (markdown, not XML)
│  wiki/_index.json    │
│  wiki/_meta.json     │
└────────┬─────────────┘
         │  S3 PutObject event
         ▼
   auto-ingest Lambda → Bedrock KB → S3 Vectors
       (same pipeline as raw docs — wiki pages
        become retrievable via search_knowledge)
```

**Why two LLM calls instead of one?** The structure call plans topically using just filenames + first-N-chars of each source — cheap, wide context. The per-page call gets the full content of that page's `relevant_files` — deep context, narrow scope. Generating the whole wiki in one prompt would blow the context window on anything beyond a handful of docs and produce worse structure.

**Why XML for the plan?** Nested lists-of-lists (sections → pages → relevant_files + related_pages) serialize cleanly in XML and Opus emits it reliably without JSON-mode. The XML is scratch — only the generated markdown lands in S3.

**Source citations.** Each page's per-page prompt requires `Sources: [file.md]()` lines under every claim. Combined with the `sources[]` array in `_index.json`, this gives the Wiki tab the "Synthesized from" footer and preserves the provenance chain back to the raw docs (which are still there, unchanged).

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
- The MCP server doesn't write to the KB directly — agents propose via `suggest_knowledge`, which lands in the review queue (see [Knowledge suggestions](#knowledge-suggestions-web-app)). Content flows into S3 through the web UI, approved suggestions, or the Google Workspace connectors.
- Each S3 upload triggers a full ingestion job. Bedrock handles dedup/delta indexing internally.
- To rotate the bearer token: re-run `cdk deploy -c token=<new-value>`. Redeploys the App Runner service with the new secret.
- The wiki generator writes one file per page on each run, so a full regen kicks N ingestion jobs in rapid succession. Bedrock dedups internally — it's safe, just noisy in the console.

## Roadmap / TODO

### Richer sidecar metadata for filtered retrieval

Sidecar-based metadata filtering is already wired up — see [Two-tier retrieval](#two-tier-retrieval-canonical-vs-raw). Wiki pages get a `.metadata.json` sidecar with `source`, `generated_at`, `page_slug`, `source_files`, and `search_knowledge` pushes an equals filter on `source=wiki`.

The next extension is opening the same mechanism to raw docs and exposing a `filter` arg on `search_knowledge`:

```
knowledge/
├── databases.md
├── databases.md.metadata.json          ← sidecar for a raw doc
│     {
│       "metadataAttributes": {
│         "team":    "platea",
│         "origin":  "notion",
│         "updated": "2026-04-18"
│       }
│     }
├── domain-knowledge/amplia.md
└── domain-knowledge/amplia.md.metadata.json
```

Query-time filter on the raw tier (hypothetical — requires extending `search_knowledge` with a `filter` param and/or a `tier: "raw" | "wiki"` arg):

```
search_knowledge(
  query  = "pricing strategy",
  tier   = "raw",
  filter = { equals: { key: "team", value: "platea" } }
)
```

**To extend:**
1. Decide on a sidecar-generation path for raw docs (commit alongside, auto-derive from frontmatter, or compute in a custom ingestion transformation Lambda).
2. Add a `filter` (and possibly `tier`) arg on `search_knowledge`; compose it with the existing `source=wiki` filter via Bedrock's `andAll`/`orAll`.
3. Custom attributes default to filterable, subject to the 2KB-per-vector cap — short strings only.

**When it's worth adding:**
- Multiple distinct knowledge domains in one KB and you want queries scoped to one.
- Freshness filtering (e.g. "exclude anything older than 6 months").
- Per-audience views (engineering-only docs vs shared team docs).
- Hybrid retrieval that pulls recent raw docs alongside canonical wiki chunks when the wiki is stale vs. the source.

### Other ideas

- **GitHub OAuth flow** — today the GitHub connector takes a PAT (simple, but tied to the user who generated it). A GitHub App / OAuth flow would scope per-user, support per-repo install consent, and avoid the rotation footgun with `gho_` tokens issued via `gh auth token`.
- **Chat connector (Slack / Discord)** — ingest pinned messages + specific channel transcripts into `sources/chat/<channel>/<day>.md`. More interesting for "what did we decide last week" retrieval than for structured knowledge.
- **Per-page code-wiki cache** — today the cost guard skips the *entire* code-wiki regen when the repo's tree SHA hasn't moved. A finer-grained version would cache each generated page by the hash of its `relevant_files` content so changes in one module don't re-Opus the whole repo's pages.
- **Deep links to wiki pages** — `/wiki?repo=foo-bar&slug=architecture` to URL-restore selection across reloads + make pages shareable. Today selection is in component state only.
- **Per-folder descriptions** — drop a `_about.md` in each folder that explains what the folder is for ("use knowledge in here when solving anything database-related"). Bedrock indexes it like any other markdown so semantic search picks it up naturally. The web UI would filter `_about.md` out of the normal list and show its content under the folder name, Devin-style. Stronger variant: wire `customTransformationConfiguration` on `CfnDataSource` to a Lambda that prepends the folder context to every file at ingestion time, so every chunk's vector carries the folder context.
- **Hierarchical or semantic chunking** — better retrieval on long, structured docs. Higher ingestion cost. Swap the `chunkingConfiguration` on `CfnDataSource`.
- **Per-user auth via Cognito + JWT** — graduate from the shared bearer token when you need per-person audit trails. Swap `StaticTokenVerifier` for FastMCP's `JWTVerifier` pointing at a Cognito user pool.
- **Multimodal ingestion** — Bedrock KB supports images and tables via `SupplementalDataStorageLocation`. Worth it if team knowledge ever includes diagrams/screenshots.
- **Migrate App Runner → ECS Express Mode** — AWS announced April 30, 2026 that App Runner is closed to new customers. Existing services (ours) keep working indefinitely, but no new features are planned. AWS's recommended successor is [ECS Express Mode](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html). Hold off until (a) AWS announces an actual App Runner EOL date, or (b) ECS Express Mode has been GA long enough to be battle-tested. At our scale the migration would also add ALB costs (~$16/mo minimum) on top of existing Fargate charges.
