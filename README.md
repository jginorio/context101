# Context101

An open-source alpha MCP knowledge base for trusted internal teams, backed by **Amazon Bedrock Knowledge Bases** with S3 + S3 Vectors, and hosted on AWS with bearer-token auth.

Create **as many brains as you want from the web admin UI** — each brain is a fully isolated knowledge base (own S3 bucket, own Bedrock KB, own vector index, own suggestions queue, own bearer token). One MCP service serves every brain; clients reach a specific brain via `/brain/<brain_id>/mcp`.

> **Alpha status:** Context101 started as an internal proof of concept. It is useful today for self-hosted, trusted-team deployments, but it is not production-ready SaaS infrastructure and it is not ready for public multi-tenant hosting. Read [ALPHA.md](./ALPHA.md) before deploying with sensitive data.

## Architecture

```
┌──────────────┐  ┌──────────┐  ┌─────────────┐
│ Claude       │  │  Cursor  │  │ Claude Code │  ...
└──────┬───────┘  └────┬─────┘  └──────┬──────┘
       │   /brain/<id>/mcp + per-brain bearer token
       └───────────────┼───────────────┘
                       ▼
            ┌─────────────────────┐
            │  App Runner         │  ← one TLS URL, brain
            │  FastMCP container  │    resolved from URL path
            └──────────┬──────────┘
                       │
                       ▼
            ┌─────────────────────┐
            │  BrainsTable (DDB)  │  ← registry: per-brain
            │  brain_id → handles │    KB id, bucket, token ARN, …
            └──────────┬──────────┘
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
  Per-brain      Per-brain        Per-brain
  Bedrock KB     S3 docs bucket   bearer token
  (Titan v2)     (markdown, ver.) (Secrets Manager)
       │               │
       ▼               ▼
  S3 Vectors      Lambda auto-
  index/<brain>   ingest on PutObject
                  (looks up brain from event bucket)
```

The control plane (create / delete a brain from the **/brains** page) is a Lambda that calls `s3:CreateBucket`, `bedrock-agent:CreateKnowledgeBase`, `s3vectors:CreateIndex`, `dynamodb:CreateTable`, and `secretsmanager:CreateSecret` against a fixed `context101-brain-*` naming pattern. The existing single brain (pre-multi-brain) is registered as `brain_id="default"` on first deploy of this system — no data migration, no URL changes for existing clients (the legacy `/mcp` path remains as an alias for the default brain).

## Repo Layout

```
.
├── cdk/                          # TypeScript CDK — all AWS infra
│   ├── bin/context101.ts
│   ├── lib/
│   │   ├── context101-stack.ts
│   │   └── brain-shared.ts       # BrainsTable + BrainProvisionerFn + default-brain seed
│   └── lambda/
│       ├── brain-provisioner/    # Web UI → create/delete a brain at runtime
│       ├── auto-ingest/          # S3 event → look up brain → Bedrock StartIngestionJob
│       ├── start-wiki-gen/       # SSR → ecs:RunTask shim (per-brain DOCS_BUCKET override)
│       ├── connector-dispatch/   # EventBridge 6h → fan-out across every brain's connectors
│       └── connector-sync-{sheets,docs,slides,notion,github}/
├── server.py                     # Python MCP server (FastMCP + boto3 + brain routing)
├── Dockerfile                    # Used by App Runner
├── knowledge/                    # Optional bootstrap seed for the default brain
├── site/                         # Standalone public website / marketing page
├── web/                          # Deployable Next.js admin app (Amplify Hosting)
│   ├── app/brains/               # /brains admin page (create / delete brains)
│   ├── app/api/brains/           # registry endpoints (list/create/get/delete/token)
│   ├── lib/brains-server.ts      # resolveBrainFromRequest + registry helpers
│   └── lib/brain-context.tsx     # client-side BrainProvider + useBrain()
├── wiki-generator/               # Fargate task — per-brain DOCS_BUCKET via overrides
└── requirements.txt
```

The public homepage is deliberately separate from the deployable app. Self-hosters deploy `web/`; `site/` exists for the project website and can be hosted independently. The `web/` root route redirects into the authenticated app instead of shipping marketing copy into every internal deployment.

## Public Alpha Caveats

Context101 is designed to be easy to try in an AWS account, not to be a hardened hosted platform yet.

- **Trusted users only:** any signed-in Cognito user can currently create, switch, and delete brains, and can reveal ready brain bearer tokens.
- **No per-brain RBAC yet:** brains are isolated at the AWS resource level, but web-app authorization does not restrict users to specific brains.
- **MCP auth is bearer-token based:** per-brain tokens are stored in Secrets Manager and cached by the MCP server. Per-user JWT auth is a roadmap item.
- **Connectors are alpha:** Google Workspace, Notion, and GitHub sync content into markdown, but the flows are intentionally simple. GitHub currently uses a pasted PAT.
- **AWS-first deployment:** the smooth path assumes `us-east-1`, CDK bootstrap, Docker, Bedrock model access, and connector OAuth secrets if you use connectors.
- **Runtime brains live outside CloudFormation:** delete non-default brains from `/brains` before stack teardown, or manually sweep retained resources.

See [SECURITY.md](./SECURITY.md) for the current security model and [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidance.

## Prerequisites

Before your first deploy, make sure you have:

**Local tooling**
- **AWS CLI v2** authenticated for the target account (`aws sts get-caller-identity` should work). The examples use `AWS_PROFILE=<your-profile>`; replace with your own profile/region.
- **Node 20+** and **npm** — for the CDK app and the Next.js web build.
- **Docker** — CDK asset bundling for the wiki-generator image uses it. `colima start` on macOS if you use Colima.
- **GitHub CLI (`gh`)** or a manually-created Personal Access Token — Amplify Hosting needs a GitHub token with `repo` scope to watch your fork. `gh auth token` returns one if you're already logged in.
- **Python 3.11+** — only if you want to run the MCP server or the wiki generator locally.

**AWS account setup**
- **Region** — everything is wired up for `us-east-1`. It can be changed, but S3 Vectors and the Opus 4.7 cross-region inference profile (`us.anthropic.claude-opus-4-7`) have region caveats; staying in `us-east-1` for the first deploy is the smooth path.
- **CDK bootstrap** — run once per account+region:
  ```bash
  npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
  ```
- **Bedrock model access** — enable the models we use in the Bedrock console → *Model access*:
  - `amazon.titan-embed-text-v2:0` (embeddings for the KB)
  - `us.anthropic.claude-opus-4-7` (the *Improve with AI* button and the wiki generator — requires a Marketplace subscription, done once via the "Request access" flow)

  Without these, `cdk deploy` will still succeed, but writes to `/improve` and wiki regen will 403.

**GitHub**
- Fork this repo to your own account. CDK references the repo by owner/name inside `lib/context101-stack.ts` — update the `repository` URL there if your fork lives elsewhere.

**(Optional) Provider OAuth clients** — only needed if you plan to use the data connectors. See [Data source connectors](#data-source-connectors) for Google + Notion setup; they're no-ops until you provision their secrets.

## Setup

> 🛡️ **Use the deploy wrapper.** All the `cdk deploy` examples below go through `./cdk/deploy.sh`, which refuses to run unless both gating tokens (`CTX_TOKEN`, `CTX_GH_TOKEN`) are set in a local env file. Skipping it once already cost the team a full stack rebuild — see [Why the wrapper exists](#why-the-wrapper-exists). One-time setup:
>
> ```bash
> cp cdk/.deploy-env.example cdk/.deploy-env   # or ~/.context101/deploy-env
> $EDITOR cdk/.deploy-env                       # paste your bearer token
> chmod 600 cdk/.deploy-env
> ```
>
> The GitHub PAT is auto-discovered from `gh auth token` if you have the GitHub CLI logged in.

### 1. First deploy (minimal — just KB + docs bucket)

```bash
cd cdk
npm install
./deploy.sh
```

This provisions the baseline infra — S3 docs bucket, Bedrock Knowledge Base, S3 Vectors, DynamoDB tables, all Lambdas. To also seed the docs bucket with the example markdown under `knowledge/` so a brand-new stack isn't empty, pass `--seed`:

```bash
./deploy.sh --seed
```

The seed flag is **off by default** so subsequent deploys never clobber whatever your team has put in S3 via the web UI / connectors / approved suggestions. Once you're past first deploy, omit the flag — the bucket itself is retained and stays the source of truth. The auto-ingest Lambda kicks off a Bedrock ingestion job on every S3 write; wait ~1-3 min after a write before searching (watch the KB in the AWS console).

> **Source of truth:** At runtime, the **S3 docs bucket** is the source of truth. Content is managed through the web admin UI, agent `suggest_knowledge` proposals (reviewed in the Suggestions tab), and data connectors. The local `knowledge/` folder is just an **optional bootstrap seed** that's only uploaded when you pass `-c seed=true`. Avoid editing files in the S3 console directly — use the web UI so writes go through the app's auth, approval, and audit surfaces.

**Key outputs** (you'll want to save these):
- `BrainsTableName` — the DDB registry of brains; the MCP + web app both read this on every request
- `BrainProvisionerFnName` — the Lambda the `/brains` page invokes to create/delete a brain
- `DocsBucketName` / `KnowledgeBaseId` — the default brain's bucket + KB (registered into `BrainsTable` as `brain_id="default"` by a one-shot custom resource)

The web admin UI and App Runner MCP service are **gated on two CDK context flags** (they only deploy if you pass them). See the next two sections.

### 2. Deploy the MCP service + web admin UI

Both come up together once `CTX_TOKEN` and `CTX_GH_TOKEN` are in your `.deploy-env` file (see the box above):

```bash
./deploy.sh
```

`McpUrl` and `WebAppDefaultDomain` appear in the outputs. Rotating the bearer token = edit `.deploy-env` and re-run the wrapper; rotating the GitHub PAT = same thing, or `gh auth refresh` if you're using the gh-CLI fallback.

`WebAppDefaultDomain` is the URL to share with teammates (e.g. `https://main.abc123xyz.amplifyapp.com`). The first Amplify build takes ~4 min.

### Why the wrapper exists

The stack's App Runner MCP service and the entire Amplify branch (web app + Cognito user pool + wiki-gen Fargate task) are wrapped in `if (teamToken) { ... }` / `if (githubToken) { ... }` blocks. A bare `cdk deploy` with neither flag tells CloudFormation those resources should no longer exist — so it deletes them. **This has happened once already.** Recovery took ~30 min plus a fresh Cognito user pool (= invite everyone again) and a new App Runner URL (= update every teammate's MCP client config).

`./cdk/deploy.sh` refuses to call `cdk deploy / diff / destroy` without both tokens, sourced from `cdk/.deploy-env` (repo-local, gitignored) or `~/.context101/deploy-env` (user-global). It also falls back to `gh auth token` for the GitHub PAT so you can ignore that field if you have the gh CLI logged in.

> ⚠️ **Amplify build timing gotcha:** if CDK added new Amplify env vars during *this* deploy, the build that was auto-triggered from the deploy doesn't see them — you need to kick one more build after the deploy finishes:
> ```bash
> aws amplify start-job --app-id <WebAppId> --branch-name main --job-type RELEASE
> ```

### 3. Create your first Cognito user

Cognito is provisioned by Amplify Gen 2 auth on the first web build. Self-signup is off — you invite yourself manually:

```bash
# Find the user pool (fresh deploys get a new one every time the Amplify app is recreated)
POOL_ID=$(aws cognito-idp list-user-pools --max-results 30 \
  --query 'UserPools[?contains(Name, `amplifyAuthUserPool`)] | sort_by(@, &CreationDate)[-1].Id' \
  --output text --region us-east-1)

aws cognito-idp admin-create-user \
  --user-pool-id "$POOL_ID" \
  --username YOUR_EMAIL \
  --user-attributes Name=email,Value=YOUR_EMAIL Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL \
  --region us-east-1
```

Check your inbox for a temp password (from `no-reply@verificationemail.com`). First login at `WebAppDefaultDomain` forces a password reset.

### 4. (Optional) Set up data-source connectors

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

### 5a. Run locally for dev

The container reads `BRAINS_TABLE` and resolves the rest (KB id, bucket, token) per request from the registry. Local dev points at the same table:

```bash
pip install -r requirements.txt

export AWS_PROFILE=<your-profile>
export AWS_REGION=us-east-1
export BRAINS_TABLE=context101-brains

uvicorn server:app --port 8787 --host 0.0.0.0
```

Hit `http://localhost:8787/brain/default/mcp` with the default brain's bearer token (look it up under **About → Connect your MCP client** in the web UI, or read `context101-brain-default-token` from Secrets Manager).

### 5b. Use the deployed App Runner service (team)

Each brain gets its own URL and its own bearer token. Both come from the **About** page in the web admin UI — click "Copy" on the snippet for the brain you want to attach to.

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "context101": {
      "url": "https://<McpHost>/brain/<brain_id>/mcp",
      "headers": {
        "Authorization": "Bearer <per-brain-token>"
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
        "https://<McpHost>/brain/<brain_id>/mcp",
        "--header",
        "Authorization: Bearer <per-brain-token>"
      ]
    }
  }
}
```

Restart Claude Desktop and Context101 should appear in the tools list. The `-y` lets `npx` auto-install `mcp-remote` the first time.

> **Multiple brains in one client.** Use a distinct `mcpServers` key per brain (e.g. `"context101-marketing"`, `"context101-engineering"`) so the client treats them as separate servers. The `/about` page does this automatically — it labels each snippet with the brain's display name.

## Optional MCP client bootstrap

The web app's **About** page shows copy-paste snippets for each ready brain. That is the recommended open-source path.

There is also a local helper script at `scripts/install-mcps.sh` that was originally built for one internal team to merge several MCP servers into Claude Desktop. Treat it as a starting point, not a product feature: edit its catalog before sharing it with your own team, and do not serve it publicly without review.

## Inviting teammates to the web app

The web admin UI is gated by Cognito. Self-signup is off by design — you invite people explicitly. Each invite sends an email with a one-time temp password; on first login they set a real one.

Share the `WebAppDefaultDomain` output from `cdk deploy` with your teammates (e.g. `https://main.dolgu9byu4ct1.amplifyapp.com`).

### Find the current user pool ID

The pool ID changes every time the Amplify app is recreated (e.g. if you destroy the `if (githubToken)` branch and redeploy). Find the latest one:

```bash
POOL_ID=$(aws cognito-idp list-user-pools --max-results 30 \
  --query 'UserPools[?contains(Name, `amplifyAuthUserPool`)] | sort_by(@, &CreationDate)[-1].Id' \
  --output text --region us-east-1)
echo "$POOL_ID"
```

### Invite a teammate

```bash
aws cognito-idp admin-create-user \
  --user-pool-id "$POOL_ID" \
  --username TEAMMATE_EMAIL \
  --user-attributes Name=email,Value=TEAMMATE_EMAIL Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL \
  --region us-east-1
```

Replace `TEAMMATE_EMAIL` (both places) with their actual email. They'll get an email titled "Your temporary password" from `no-reply@verificationemail.com`.

### Revoke access

```bash
aws cognito-idp admin-delete-user \
  --user-pool-id "$POOL_ID" \
  --username TEAMMATE_EMAIL \
  --region us-east-1
```

### Separate from the MCP bearer tokens

Note: Cognito accounts control access to the **web admin UI**. The **MCP endpoints** use **per-brain bearer tokens** stored in Secrets Manager (one per brain, auto-generated at brain creation time). Rotating one doesn't affect the other.

- **Default brain's token** — comes from `CTX_TOKEN` in `cdk/.deploy-env` and is stored in the `context101-bearer-token` secret. To rotate: edit `.deploy-env`, re-run `./cdk/deploy.sh`, redistribute.
- **Other brains' tokens** — stored in `context101-brain-<brain_id>-token`. To rotate, update the secret value directly with `aws secretsmanager put-secret-value` (no redeploy). The MCP server's token cache picks up the new value within ~5 min.

## Managing brains

Every brain is a fully isolated silo: its own S3 docs bucket, Bedrock Knowledge Base, vector index, suggestions queue, connectors table, and bearer token. Brains share the App Runner MCP service, the wiki Fargate task, the Cognito user pool, and the connector OAuth client secrets.

### Create a brain (web UI)

1. Sign in to the admin UI, click **Brains** in the header.
2. Click **+ New brain**, enter a display name (e.g. "Marketing") + optional description, submit.
3. The row appears with `status=provisioning` and the dialog closes. Behind the scenes, `BrainProvisionerFn` creates the bucket, Bedrock KB, vector index, DDB tables, and bearer-token secret — typically 30–60 seconds.
4. Status flips to `ready`; the header brain switcher gains the new brain. Click **Copy** next to the MCP URL on the brain's row (or visit **About**) to get a copy-pasteable client config.

### Switch brain

The brain switcher next to the "Context101" title shows every `ready` brain. Selecting one:

- writes the `ctx_brain` cookie,
- updates the URL with `?brain=<id>` so the page is shareable, and
- causes every SSR route to read/write the selected brain's bucket and tables.

API routes accept the brain id in this priority: `?brain=<id>` → `x-brain-id` header → `ctx_brain` cookie → `"default"`.

### Delete a brain

Click the trash icon on the brain's row on `/brains`, type the display name to confirm. The provisioner empties + deletes the S3 bucket (including all object versions), deletes the Bedrock KB + data source, the vector index, both DDB tables, the bearer-token secret, and finally removes the registry row. The default brain is refused.

> **No per-brain RBAC yet.** Any signed-in Cognito user can create, switch, or delete any brain, just like they can edit any file today. Per-brain ACLs are a follow-up.

### Idle cost per brain

- S3 docs bucket: $0/mo idle (object-storage only)
- Bedrock KB + S3 Vectors index: $0/mo idle (pay-per-query)
- DDB suggestions + connectors tables: $0/mo idle (on-demand billing)
- Bearer-token secret: ~$0.40/mo
- App Runner MCP: **shared** across all brains, ~$5–15/mo total

So a hundred brains cost about the same as one, plus ~$40/mo in extra secrets.

## Daily Workflow

Each brain's docs bucket is its own source of truth. Pick a brain via the header switcher; the Files, Wiki, Suggestions, and Sources tabs are all scoped to whatever brain is active. Content flows in through three paths — none of them require a deploy:

1. **Web admin UI** — the primary surface for humans. Create, edit, rename, move, or delete markdown files; use **Improve with AI** for Opus-assisted rewrites; review and approve incoming agent proposals from the Suggestions tab.
2. **`suggest_knowledge` MCP tool** — agents (Cursor, Claude Desktop, Claude Code, Devin) propose new docs or updates as they work. Proposals land in the **active brain's** review queue; nothing reaches the brain until a human approves. See [Knowledge suggestions](#knowledge-suggestions-web-app).
3. **Data connectors** — pull content automatically from where teams already write it. **Google Sheets, Google Docs, Google Slides, Notion, and GitHub** all attach to **one brain** at create time and re-sync every 6 hours. See [Data source connectors](#data-source-connectors).

Every S3 write — whichever brain, whichever path — triggers the auto-ingest Lambda, which looks up the brain from the bucket name and kicks the right Bedrock ingestion job. New content is retrievable via `search_knowledge` within ~1 min once the canonical wiki catches up (manual **Refresh now** in the Wiki tab triggers an immediate re-synthesis).

`cdk deploy` is reserved for **infra changes** (new tools, IAM tweaks, etc.) and the **initial seed** of the `knowledge/` folder on a fresh stack. Brain create/delete and content management all run at runtime via the web UI.

## Tools

All four MCP tools operate on the brain identified by the URL path (`/brain/<brain_id>/mcp`). Every tool's S3 reads, KB queries, and DDB writes are scoped to that brain's resources.

| Tool | Purpose |
|------|---------|
| `search_knowledge(query, limit=5)` | Semantic search over the active brain's **canonical wiki** — returns ranked chunks from synthesized, deduplicated pages (never raw docs) |
| `read_knowledge(s3_key)` | Full content of any document in the active brain's docs bucket — raw or wiki. Escape hatch to ground truth when you need detail compressed out of the canonical view |
| `list_sources()` | Enumerate all documents currently in the active brain's docs bucket |
| `suggest_knowledge(title, content, target_path?, rationale?, trigger?)` | Propose a new doc or update for the active brain; goes to that brain's review queue — never writes directly |

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

Agents propose knowledge via `suggest_knowledge`. Proposals land in the **active brain's** DynamoDB review queue — **nothing is written until a human approves**. Each brain has its own suggestions table (`context101-brain-<brain_id>-suggestions` for non-default brains; `context101-suggestions` for default), so the /suggestions tab only shows entries for the brain you're viewing.

```
Agent (Cursor / Claude Desktop / Devin / etc.)
    │  suggest_knowledge(...)  →  /brain/<brain_id>/mcp
    ▼
MCP (App Runner, brain resolved from URL path)
    │  PutItem status=pending  →  that brain's suggestions table
    ▼
Web admin UI → /suggestions tab (scoped to active brain)
    │
    ├─ filter by status: pending / accepted / rejected / all
    ├─ click a row → drawer:
    │     ├─ update case  →  side-by-side diff (existing vs proposed)
    │     └─ new doc case →  rendered preview + editable destination path
    └─ ✓ Approve   → writes to that brain's S3 bucket → auto-ingests → queryable
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

Connect a **Google Sheet, Doc, Slides deck, Notion page/database, or GitHub repo** from the **Sources** tab. A connector **belongs to one brain** — the brain that's active in the header when you click "Add new source". The connector row lives in that brain's connectors table and writes its files into that brain's docs bucket under `sources/<type>/<slug>/…`. Re-syncing happens every 6 hours.

Each connection authenticates once (OAuth for Google/Notion, a Personal Access Token for GitHub) and the credential lives in its own Secrets Manager secret (per-connection, not per-brain). The OAuth `state` parameter encodes `<brain_id>:<connector_id>` so the callback lands back in the right brain's table.

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
  "workspace_name": "Acme",
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

Raw contributions to a brain's bucket don't need to be structured — people drop in whatever makes sense for them. A **Fargate task** reads the active brain's corpus and synthesizes a cross-referenced wiki (DeepWiki-style) under `wiki/` in **that brain's** docs bucket. The admin UI's **Wiki** tab renders it read-only with Mermaid diagrams and source citations back to the original markdown.

The same Fargate task definition handles every brain — `start-wiki-gen` reads the brain id from the request (the /wiki refresh button passes the active brain), looks up the brain's `docs_bucket` from `BrainsTable`, and injects it via `containerOverrides.environment`. Single-flight dedup keys on `(brain_id, mode, repo)` so a refresh on Brain A doesn't collide with a refresh on Brain B.

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

\
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

**Tear down a single brain:** click delete on its row in `/brains` and confirm by typing the display name. The provisioner empties the bucket, deletes the KB, vector index, DDB tables, and token secret. The default brain cannot be deleted this way.

**Tear down the whole stack:**

```bash
cd cdk
./deploy.sh destroy
```

The default brain's docs bucket and the shared S3 Vectors bucket have `RETAIN` policies, so `cdk destroy` leaves their data behind. Empty them manually if you want them gone. **Non-default brains created at runtime are NOT in CloudFormation** — they were provisioned by the brain-provisioner Lambda. `cdk destroy` does NOT clean them up; delete them from `/brains` first, or sweep the `context101-brain-*` buckets / KBs / secrets manually.

## Why this stack

- **S3 Vectors** — cheapest vector store option; stays inside S3. One index per brain inside a shared vector bucket.
- **Titan embed v2, 1024-dim** — native to Bedrock, no third-party API keys.
- **App Runner** — one stable TLS URL serving every brain, ~$5–15/mo total (does not scale with brain count).
- **Per-brain bearer tokens** — each brain has its own Secrets Manager secret. Compromise of one brain's token doesn't touch others.
- **DDB on-demand** — per-brain tables cost ~$0 idle, so brain count drives ~zero fixed cost.

## Notes

- `removalPolicy: RETAIN` on the default docs bucket and the shared vector bucket — accidental `cdk destroy` won't wipe your data. Runtime-created brain buckets follow the same convention.
- The MCP server doesn't write to a KB directly — agents propose via `suggest_knowledge`, which lands in the active brain's review queue. Content flows into S3 through the web UI, approved suggestions, or the data connectors.
- Each S3 upload triggers an ingestion job for the bucket's brain. The auto-ingest Lambda looks the brain up in `BrainsTable` by bucket name; one shared Lambda serves every brain.
- To rotate the default brain's bearer token: edit `CTX_TOKEN` in `cdk/.deploy-env` and re-run `./cdk/deploy.sh`. For other brains: `aws secretsmanager put-secret-value --secret-id context101-brain-<id>-token --secret-string '<new-value>'`. The MCP cache picks up the new value within ~5 min.
- The wiki generator writes one file per page per run, so a full regen kicks N ingestion jobs in rapid succession. Bedrock dedups internally — safe, just noisy in the console.

## Roadmap / TODO

- **Per-brain RBAC** — today any signed-in Cognito user can create / switch / delete any brain. Add Cognito groups mapped to brains, then gate `resolveBrainFromRequest` on group membership.
- **Per-user MCP auth via Cognito + JWT** — graduate from per-brain bearer tokens once you need per-person audit trails. Swap the bearer-token middleware in `server.py` for a JWT verifier pointing at the Cognito user pool, and put the brain claim in the token.
- **Sub-brain metadata filters** — within one brain, scope queries with metadata sidecars (`team`, `freshness`, `audience`). Already partially wired up via the `source=wiki` sidecar filter. Extend `search_knowledge` with an optional `filter` arg and compose it via Bedrock's `andAll`.
- **GitHub OAuth flow** — today the GitHub connector takes a PAT. A GitHub App / OAuth flow would scope per-user, support per-repo install consent, and avoid the rotation footgun with `gho_` tokens issued via `gh auth token`.
- **Chat connector (Slack / Discord)** — ingest pinned messages + specific channel transcripts into `sources/chat/<channel>/<day>.md`. More interesting for "what did we decide last week" retrieval than for structured knowledge.
- **Per-page code-wiki cache** — today the cost guard skips the *entire* code-wiki regen when the repo's tree SHA hasn't moved. A finer-grained version would cache each page by the hash of its `relevant_files`.
- **Deep links to wiki pages** — `/wiki?repo=foo-bar&slug=architecture` to URL-restore selection across reloads.
- **Per-folder descriptions** — drop a `_about.md` in each folder that explains what the folder is for. Bedrock indexes it like any other markdown so semantic search picks it up. Stronger variant: a custom ingestion-transformation Lambda that prepends folder context to every file.
- **Hierarchical or semantic chunking** — better retrieval on long, structured docs. Higher ingestion cost.
- **Multimodal ingestion** — Bedrock KB supports images and tables via `SupplementalDataStorageLocation`.
- **Migrate App Runner → ECS Express Mode** — AWS announced (April 2026) that App Runner is closed to new customers. Existing services keep working but no new features. AWS's recommended successor is [ECS Express Mode](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html). Hold off until AWS announces an actual EOL date or ECS Express Mode is battle-tested. The migration adds ~$16/mo in ALB charges.
