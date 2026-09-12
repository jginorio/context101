# Context101

your context. every agent.

A thin self-hostable wrapper around Amazon Bedrock Knowledge Bases. Docs live in S3. Retrieval uses Bedrock plus S3 Vectors. The control plane is Better Auth and Postgres.

Self-host in your AWS account now. Paid hosting is later, not shipped. Alpha, trusted-team only. Read [ALPHA.md](./ALPHA.md) before you put sensitive data in a stack.

This is not a wiki app. Retrieval is raw-first. Wiki generation is paused, optional beta. Leave the EventBridge wiki schedule off. Do not set `AUTO_TRIGGER_CODE_WIKI`.

Create as many brains as you want from the web admin. Each brain is an isolated knowledge base with its own S3 bucket, Bedrock KB, vector index, suggestions queue, and MCP bearer token. One MCP service serves every brain. Clients hit `/brain/<brain_id>/mcp`.

## Architecture

```
┌──────────────┐  ┌──────────┐  ┌─────────────┐
│ Claude       │  │  Cursor  │  │ Claude Code │  ...
└──────┬───────┘  └────┬─────┘  └──────┬──────┘
       │   /brain/<id>/mcp + per-brain bearer token
       └───────────────┼───────────────┘
                       ▼
            ┌─────────────────────┐
            │ CloudFront → Lambda │  ← one TLS URL, brain
            │  FastMCP container  │    resolved from URL path
            └──────────┬──────────┘
                       │
                       ▼
            ┌─────────────────────┐
            │ Postgres control    │  ← orgs, brains, connectors,
            │ plane (Better Auth) │    suggestions, MCP token hashes
            └──────────┬──────────┘
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
  Per-brain      Per-brain        Per-brain
  Bedrock KB     S3 docs bucket   MCP token hash
  (Titan v2)     (markdown, ver.) (Postgres)
       │               │
       ▼               ▼
  S3 Vectors      Lambda auto-
  index/<brain>   ingest on PutObject
                  (looks up brain from event bucket)
```

Postgres holds orgs, brains, connectors, suggestions, and MCP token hashes. Brain create and delete go through `BrainProvisionerFn`, which provisions AWS resources (`s3:CreateBucket`, `bedrock-agent:CreateKnowledgeBase`, `s3vectors:CreateIndex`, and related calls) against a `context101-brain-*` naming pattern and writes the brain row to Postgres.

## Repo layout

```
.
├── cdk/                          # TypeScript CDK, all AWS infra
│   ├── bin/context101.ts
│   ├── deploy.sh                 # shim. forwards to packages/cli
│   ├── lib/
│   │   ├── context101-stack.ts
│   │   ├── deploy-gate.ts        # fail-closed without CTX_TOKEN
│   │   ├── control-plane-db.ts
│   │   └── brain-shared.ts       # BrainProvisionerFn + per-brain IAM
│   └── lambda/
│       ├── brain-provisioner/    # web UI creates or deletes a brain
│       ├── auto-ingest/          # S3 event, look up brain, StartIngestionJob
│       ├── start-wiki-gen/       # SSR to ecs:RunTask, per-brain DOCS_BUCKET
│       ├── db-migrate/
│       ├── connector-dispatch/   # EventBridge 6h, fan-out per connector
│       └── connector-sync-{sheets,docs,slides,notion,github}/
├── packages/cli/                 # npm package context101-cli, bin context101
├── packages/design/
├── packages/ui/
├── server.py                     # Python MCP server, FastMCP + Postgres routing
├── Dockerfile                    # MCP image, Lambda + leftover App Runner
├── knowledge/                    # optional bootstrap seed for the default brain
├── site/                         # standalone marketing site
├── web/                          # Next.js admin, Amplify Hosting
│   ├── app/brains/
│   ├── app/api/brains/
│   ├── lib/auth/
│   ├── lib/db/
│   ├── lib/brains-server.ts
│   └── lib/brain-context.tsx
├── wiki-generator-ts/            # Fargate image CDK deploys. TypeScript only
├── scripts/install-mcps.sh       # internal helper, not a product feature
├── requirements.txt              # MCP local/runtime Python deps
├── ALPHA.md
├── SECURITY.md
├── CONTRIBUTING.md
└── WIKI_PYTHON_REMOVED.md
```

The Python tree `wiki-generator/` is gone. CDK points `WikiGenImage` at `wiki-generator-ts/`. See [WIKI_PYTHON_REMOVED.md](./WIKI_PYTHON_REMOVED.md).

`site/` is the public homepage. Self-hosters deploy `web/`. The `web/` root route sends you into the authenticated app.

## Auth and control plane

- Better Auth owns users, sessions, organizations, members, and invitations.
- Postgres stores brains, suggestions, connectors, MCP token hashes, audit logs, and usage metrics.
- MCP bearer tokens are hashed into Postgres with `MCP_TOKEN_PEPPER`. Raw tokens are not stored in the database.

Postgres connection modes:

- Neon via `DATABASE_DRIVER=[REDACTED]`
- Supabase, RDS, Aurora, or local Postgres via `DATABASE_DRIVER=postgres-js`
- For Supabase transaction pooler URLs, set `DATABASE_PREPARE=false`.

## Public alpha caveats

You can stand this up in an AWS account. It is not a hardened hosted platform.

- Trusted users only. Better Auth gates the web app. Per-brain RBAC is not shipped. Some routes still sit on the leftover control plane.
- No per-brain RBAC. Brains are isolated as AWS resources. Fine-grained per-brain roles are a follow-up.
- MCP auth is bearer-token based. Per-brain tokens hash into Postgres when `DATABASE_URL` and `MCP_TOKEN_PEPPER` are set. The MCP server still has a Secrets Manager fallback during migration.
- Connectors are alpha. Google Workspace, Notion, and GitHub sync into markdown. GitHub uses an organization-scoped GitHub App, with a PAT fallback.
- AWS-first. The smooth path assumes `[REDACTED]`, CDK bootstrap, Docker, Bedrock model access, and connector OAuth secrets if you use connectors.
- Runtime brains live outside CloudFormation. Delete non-default brains from `/brains` before stack teardown, or sweep retained resources yourself.
- Wiki generation is paused, optional beta. Retrieval does not wait on a wiki regen.
- No public multi-tenant SaaS. No billing. `BILLING_ENABLED` exists as a flag and stays `false`.

See [SECURITY.md](./SECURITY.md) for the security model and [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidance.

## Prerequisites

Local tooling:

- AWS CLI v2 authenticated for the target account. `aws sts get-caller-identity` should work. Examples use `AWS_PROFILE=<your-profile>`.
- Node 20+ and npm for the CDK app, the CLI, and the Next.js web build.
- Docker. CDK asset bundling for the `wiki-generator-ts` image uses it. `colima start` on macOS if you use Colima.
- GitHub CLI (`gh`) or a classic PAT. Amplify Hosting needs a classic PAT (`ghp_`) with `repo` scope so it can create a repo webhook. `gh auth token` only works when that token is a PAT. GitHub App installation tokens (`ghs_`) and gh OAuth tokens (`gho_`) 403 and roll the stack back. Put a PAT in `CTX_GH_TOKEN`.
- Python 3.11+ only if you want to run the MCP server locally. The wiki generator is TypeScript under `wiki-generator-ts/`.

AWS account setup:

- Region. Everything is wired for `[REDACTED]`. You can change it. S3 Vectors and the Opus 4.7 cross-region inference profile (`us.anthropic.claude-opus-4-7`) have region caveats. Stay in `[REDACTED]` for the first deploy.
- CDK bootstrap, once per account and region:

  ```bash
  npx cdk bootstrap aws://<ACCOUNT_ID>/[REDACTED]
  ```

- Bedrock model access. `context101 init` requests access for every Amazon Titan and Cohere embedding model, including new ids Bedrock lists. Amazon first-party models auto-enable. Cohere needs a Marketplace agreement. Users pick a model later in the app. CDK still defaults the first brain to `amazon.titan-embed-text-v2:0`. Claude (`us.anthropic.claude-opus-4-7`) is optional for Improve. Wiki is paused.

GitHub:

- Fork this repo. CDK references the repo by owner and name inside `lib/context101-stack.ts`. Update the `repository` URL there if your fork lives elsewhere.

Optional provider OAuth clients, only if you plan to use data connectors. See [Data source connectors](#data-source-connectors). They are no-ops until you provision their secrets.

## Setup

The CLI is the only front door.

```bash
npx context101-cli init
context101 deploy
context101 list
context101 destroy <StackName>
context101 config
context101 help
```

The npm package is `context101-cli`. The bin name is `context101`. From this checkout after `npm install`, `npm run context101 -- init` and `npx context101-cli …` both run the local CLI. `npx context101` unscoped is Context7's MCP on npm. Unrelated.

`init` clones this repo into `./context101` when you are not already in a checkout. Pass `--dir` to pick the folder. It writes a gitignored secrets file at `cdk/.deploy-env`. First deploy can add `--seed` to upload the example `knowledge/` files once.

> 🛡️ **The CLI is the front door.** Do not run `cdk deploy` yourself. CDK fails closed without `-c token=` and, when Amplify watches a repo, `githubToken`. A bare deploy cannot delete MCP or Amplify. `cdk/deploy.sh` is a shim that forwards to `packages/cli`. One-time setup if you skip the walkthrough:
>
> ```bash
> cp cdk/.deploy-env.example cdk/.deploy-env   # or ~/.context101/deploy-env
> $EDITOR cdk/.deploy-env                       # paste your bearer token
> chmod 600 cdk/.deploy-env
> ```
>
> The GitHub PAT is auto-discovered from `gh auth token` only when that token is a `ghp_` or `github_pat_` PAT. Installation tokens from Cursor or GitHub Apps are rejected before CDK runs.

### 1. First deploy

```bash
npm run context101 -- deploy
```

This provisions the baseline infra. That includes the S3 docs bucket, Bedrock Knowledge Base, S3 Vectors, the `pg-http` Lambda layer, and Lambdas. The control-plane schema lives in your Postgres database. Apply it with `npm run db:migrate` from `web/`. To also seed the docs bucket with the example markdown under `knowledge/`, pass `--seed`:

```bash
npm run context101 -- deploy --seed
```

`--seed` is off by default so later deploys never clobber what your team put in S3 through the web UI, connectors, or approved suggestions. Once you are past first deploy, omit the flag. The bucket is retained and stays the source of truth. The auto-ingest Lambda starts a Bedrock ingestion job on every S3 write. Wait about 1 to 3 minutes after a write before searching. Watch the KB in the AWS console.

At runtime the S3 docs bucket is the source of truth. Content comes from the web admin UI, agent `suggest_knowledge` proposals reviewed in Suggestions, and data connectors. The local `knowledge/` folder is an optional bootstrap seed, uploaded only with `-c seed=true`. Do not edit files in the S3 console. Use the web UI so writes go through auth, approval, and audit.

Key outputs you will want:

- `BrainProvisionerFnName`. The Lambda `/brains` invokes to create or delete a brain.
- `DocsBucketName` / `KnowledgeBaseId`. The default brain's bucket and KB. The `default` brain row lives in the Postgres `brains` registry.

The web admin UI and the MCP service only deploy when `CTX_TOKEN` is set, and `CTX_GH_TOKEN` when Amplify watches a repo.

### 2. Deploy the MCP service and web admin UI

Both come up once `CTX_TOKEN` and `CTX_GH_TOKEN` are in your `.deploy-env` file.

```bash
context101 deploy
```

`McpLambdaUrl` and `WebAppDefaultDomain` appear in the outputs. Rotate the bearer token with `context101 config set CTX_TOKEN=…` then `context101 deploy`. Rotate the GitHub PAT the same way, or `gh auth refresh` if you use the gh-CLI fallback.

`WebAppDefaultDomain` is the URL to share with teammates, for example `https://main.abc123xyz.amplifyapp.com`. The first Amplify build takes about 4 minutes.

MCP compute is a Lambda container, same Docker image, run via the [Lambda Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter), behind a Function URL and CloudFront. It scales to zero. Idle cost is about $0/mo. Fresh deploys get only the Lambda path. `McpLambdaUrl` is the endpoint. Older deployments also have the leftover App Runner service (`McpUrl` output). See the migration runbook below. Cold starts add about 1 to 4 seconds to the first request after idle. Per-brain bearer auth is the same on both paths.

### Migrating an existing deployment off App Runner

App Runner [closed to new customers in April 2026](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html) and costs about $10/mo idle. The Lambda path replaces it for about $0/mo. Existing stacks keep App Runner until you remove it. CDK keeps it while `MCP_APPRUNNER` is unset. Cutover is zero-downtime.

1. Deploy with `context101 deploy`. Both compute paths serve the same brains. Grab `McpLambdaUrl` and `McpDistributionDomain` from the outputs.
2. Smoke-test the Lambda path. Point one MCP client at `https://<McpDistributionDomain>/brain/<brain_id>/mcp` with the same bearer token and run `search_knowledge`.
3. Custom domain, skip if you do not use one. Request an ACM cert in `[REDACTED]` for your MCP host (`aws acm request-certificate --domain-name mcp.example.dev --validation-method DNS`), create the validation CNAME at your DNS provider, wait for `ISSUED`, then set `MCP_DOMAIN_CERT_ARN=<cert-arn>` with `MCP_PUBLIC_HOST` already set in `.deploy-env` and re-deploy. The domain attaches to the CloudFront distribution.
4. Cut DNS. Change the MCP host's CNAME from the App Runner domain to `<McpDistributionDomain>`. Clients keep working through the flip. Same path shape, same tokens. The Lambda path runs MCP session-less, which every streamable-HTTP client handles.
5. Remove App Runner. Once DNS has propagated and Lambda CloudWatch logs look clean, unlink the custom domain from the App Runner service in the console, set `MCP_APPRUNNER=false` in `.deploy-env`, and re-deploy. CloudFormation deletes the service. The idle charge stops.

### Why CDK fails closed

The stack's MCP service, Lambda plus CloudFront, plus leftover App Runner where still enabled, and the Amplify branch, web app plus wiki-gen Fargate, are wrapped in `if (teamToken)` and `if (githubToken)` blocks. A bare `cdk deploy` with neither flag used to tell CloudFormation those resources should no longer exist, so it deleted them. This has happened once already. Recovery took about 30 minutes plus a new MCP URL.

CDK now throws on `deploy`, `synth`, and `diff` when `token` is missing, and when `REPOSITORY` is set without `githubToken`. `cdk destroy` of the whole stack is still allowed. `context101 deploy` loads `cdk/.deploy-env` or `~/.context101/deploy-env`. Env vars win. `gh auth token` is the GitHub PAT fallback. The CLI passes the same `-c` flags. `context101 destroy <StackName>` is the intentional teardown.

If CDK added new Amplify env vars during this deploy, the build auto-triggered from the deploy does not see them. Kick one more build after the deploy finishes:

```bash
aws amplify start-job --app-id <WebAppId> --branch-name main --job-type RELEASE
```

### 3. Create your first admin

Auth runs on Better Auth and Postgres. Set these in `cdk/.deploy-env` or `~/.context101/deploy-env` before deploying:

```bash
DATABASE_URL="postgresql://..."
DATABASE_DRIVER="[REDACTED]"        # or postgres-js
DATABASE_PREPARE="true"            # false for Supabase transaction pooler
BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
# Omit BETTER_AUTH_URL / APP_URL to use Amplify's default
# https://main.<app-id>.amplifyapp.com, or set a domain you own.
# Never a hosted Context101 product URL. Paid hosting is not shipped.
APP_MODE="self_hosted"
ALLOW_PUBLIC_SIGNUP="false"
BILLING_ENABLED="false"
MCP_TOKEN_PEPPER="$(openssl rand -base64 32)"
SES_REGION="[REDACTED]"
SES_FROM_EMAIL="Context101 <no-reply@your-domain.com>"
SES_REPLY_TO_EMAIL="support@your-domain.com" # optional
```

Visit `/setup` on `WebAppDefaultDomain`, or your own host, after the web app is live. That creates the first Better Auth user and organization. Keep `ALLOW_PUBLIC_SIGNUP=false` and `BILLING_ENABLED=false`. Invite people yourself.

### 4. Optional data-source connectors

OAuth client creds live in Secrets Manager. See [Data source connectors](#data-source-connectors) for per-provider setup. Short version:

```bash
# Google, needed for Sheets, Docs, Slides
aws secretsmanager create-secret \
  --name context101-google-oauth-client \
  --secret-string '{"client_id":"…","client_secret":"…"}' \
  --region [REDACTED]

# Notion
aws secretsmanager create-secret \
  --name context101-notion-oauth-client \
  --secret-string '{"client_id":"…","client_secret":"…"}' \
  --region [REDACTED]
```

CDK references both secrets by name, not value. Rotating creds does not require a redeploy. If a secret does not exist yet, that connector's "Add new source" flow returns a clear 500 until it does.

### 5a. Run the MCP server locally

The container reads the brain registry from Postgres (`DATABASE_URL`) and resolves KB id, bucket, and token per request. Local dev points at the same database:

```bash
pip install -r requirements.txt

export AWS_PROFILE=<your-profile>
export AWS_REGION=[REDACTED]
export DATABASE_URL="postgresql://..."
export MCP_TOKEN_PEPPER="<same value as the web app>"

uvicorn server:app --port 8787 --host 0.0.0.0
```

Hit `http://localhost:8787/brain/default/mcp` with the default brain's bearer token. Look it up under About, then Connect your MCP client, in the web UI, or read `context101-brain-default-token` from Secrets Manager.

### 5b. Use the deployed MCP service

Each brain gets its own URL and its own bearer token. Both come from the About page. Click Copy on the snippet for the brain you want.

Cursor (`.cursor/mcp.json`):

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

Claude Desktop only speaks MCP over stdio, so use `mcp-remote` as a local proxy. Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

Restart Claude Desktop. Context101 should appear in the tools list. `-y` lets `npx` install `mcp-remote` the first time.

Multiple brains in one client. Use a distinct `mcpServers` key per brain, for example `"context101-marketing"` and `"context101-engineering"`. The `/about` page does this and labels each snippet with the brain's display name.

## Optional MCP client bootstrap

The web app's About page shows copy-paste snippets for each ready brain. That is the recommended path.

`scripts/install-mcps.sh` was built for one internal team to merge several MCP servers into Claude Desktop. Treat it as a starting point, not a product feature. Edit its catalog before sharing it. Do not serve it publicly without review.

## Inviting teammates to the web app

Auth uses Better Auth organizations. Create the first admin at `/setup`, then invite teammates through the organization-member flow. Share the `WebAppDefaultDomain` output, for example `https://main.dolgu9byu4ct1.amplifyapp.com`.

### Separate from the MCP bearer tokens

Better Auth controls the web admin UI. MCP endpoints use per-brain bearer tokens. When `DATABASE_URL` and `MCP_TOKEN_PEPPER` are set, those tokens validate against hashes in Postgres, with a Secrets Manager fallback. Rotating web auth credentials does not affect MCP tokens.

- Default brain token comes from `CTX_TOKEN` in `cdk/.deploy-env` and is stored in `context101-bearer-token`. Rotate with `context101 config set CTX_TOKEN=…`, then `context101 deploy`, then redistribute.
- Other brains' tokens live in `context101-brain-<brain_id>-token`. Rotate with `aws secretsmanager put-secret-value`. No redeploy. The MCP server's token cache picks up the new value within about 5 minutes.

## Managing brains

Every brain is an isolated silo with its own S3 docs bucket, Bedrock Knowledge Base, vector index, suggestions queue, connectors table, and bearer token. Brains share the MCP service, the wiki Fargate task definition, Better Auth web login and orgs, and the connector OAuth client secrets.

### Create a brain

1. Sign in to the admin UI. Click Brains in the header.
2. Click + New brain. Enter a display name, for example Marketing, plus an optional description. Submit.
3. The row appears with `status=provisioning` and the dialog closes. `BrainProvisionerFn` creates the bucket, Bedrock KB, vector index, and bearer-token secret, and writes the brain row to Postgres. Typically 30 to 60 seconds.
4. Status flips to `ready`. The header brain switcher gains the new brain. Click Copy next to the MCP URL on the row, or visit About, for a client config.

### Switch brain

The brain switcher next to the Context101 title shows every `ready` brain. Selecting one writes the `ctx_brain` cookie, updates the URL with `?brain=<id>` so the page is shareable, and causes every SSR route to read and write the selected brain's bucket and tables.

API routes accept the brain id in this order: `?brain=<id>`, then `x-brain-id` header, then `ctx_brain` cookie, then `"default"`.

### Delete a brain

Click the trash icon on the brain's row on `/brains`. Type the display name to confirm. The provisioner empties and deletes the S3 bucket, including all object versions, deletes the Bedrock KB and data source, the vector index, and the bearer-token secret, then removes the Postgres `brains` row. Connectors, suggestions, and MCP tokens cascade-delete with it. The default brain is refused.

No per-brain RBAC yet. Better Auth gives organization membership. Fine-grained per-brain roles are a follow-up.

### Idle cost per brain

- S3 docs bucket: $0/mo idle, object storage only
- Bedrock KB and S3 Vectors index: $0/mo idle, pay per query
- Suggestions and connectors: stored in Postgres, near-zero idle cost at normal alpha scale
- Bearer-token secret: about $0.40/mo
- MCP service, Lambda plus CloudFront: shared across all brains, about $0/mo idle. Leftover App Runner, where still enabled, about $5 to $15/mo

A hundred brains cost about the same as one, plus about $40/mo in extra secrets.

## Daily workflow

Each brain's docs bucket is its own source of truth. Pick a brain via the header switcher. Files, Suggestions, and Sources are scoped to the active brain. The Wiki tab is optional beta and paused as a product surface. Content flows in through three paths. None of them require a deploy.

1. Web admin UI. The primary surface for humans. Create, edit, rename, move, or delete markdown files. Use Improve with AI for Opus-assisted rewrites. Review and approve incoming agent proposals from Suggestions.
2. `suggest_knowledge` MCP tool. Agents propose new docs or updates. Proposals land in the active brain's review queue. Nothing reaches the brain until a human approves. See [Knowledge suggestions](#knowledge-suggestions-web-app).
3. Data connectors. Pull content from where teams already write it. Google Sheets, Google Docs, Google Slides, Notion, and GitHub attach to one brain at create time and re-sync every 6 hours. See [Data source connectors](#data-source-connectors).

Every S3 write triggers the auto-ingest Lambda, which looks up the brain from the bucket name and starts the right Bedrock ingestion job. New content is retrievable via `search_knowledge` within about 1 minute of ingestion. Retrieval is raw-first. It does not wait on a wiki regeneration.

`context101 deploy` is for infra changes and the optional first seed of `knowledge/` on a fresh stack. Brain create, delete, and content management run at runtime via the web UI. Do not run bare `cdk deploy`.

## Tools

All four MCP tools operate on the brain identified by the URL path (`/brain/<brain_id>/mcp`). S3 reads and KB queries stay on that brain's resources. Suggestions write to the Postgres `suggestions` table, keyed by `brain_id`.

| Tool | Purpose |
|------|---------|
| `search_knowledge(query, limit=5)` | Semantic search over the active brain. Raw docs plus wiki overview pages if any exist. Code is excluded (`source=github` repo files and `source=code-wiki` pages). Results stay fresh without waiting on a wiki regen |
| `read_knowledge(s3_key)` | Full content of any document in the active brain's docs bucket. Raw, wiki, or code. Use this when a chunk cites a file you need in full, or for the code sources search excludes |
| `list_sources()` | Enumerate all documents currently in the active brain's docs bucket |
| `suggest_knowledge(title, content, target_path?, rationale?, trigger?)` | Propose a new doc or update for the active brain. Goes to that brain's review queue. Never writes directly |

### Raw-first retrieval

The knowledge base holds several kinds of documents, all embedded in the same vector index:

- Raw sources. What contributors write or what connectors drop in. Notion, Google Docs, Sheets, Slides, `suggest_knowledge` approvals, manual uploads.
- Code sources under `sources/github/`. Repo files synced by the GitHub connector, tagged `source=github`.
- Wiki pages under `wiki/`, when someone has run the optional generator. Synthesized overview pages, tagged `source=wiki`. Per-repo code wikis under `wiki/code/` are tagged `source=code-wiki`.

`search_knowledge` searches everything except code, via a `notIn` metadata filter:

```json
{ "notIn": { "key": "source", "value": ["github", "code-wiki"] } }
```

Docs without a `.metadata.json` sidecar, typically manual uploads, have no `source` attribute. `notIn` still matches them. This is everything except code, not an allowlist.

Why this shape:

- Freshness. Raw chunks are searchable about 1 minute after ingestion. Retrieval never waits on a wiki regeneration. Content the wiki planner did not pick a page for is still findable.
- Wiki as optional overlay. Wiki pages stay in the search pool when they exist. They are not the product and they do not bound what is retrievable.
- Code stays out of the way. Synced repo files outnumber team docs by a wide margin. Unfiltered they would dominate top-K. Agents reach code via `read_knowledge(s3_key)` on `sources/github/…` files or `wiki/code/…` pages.
- Traceable. Wiki chunks cite their raw sources via `Sources: [file]()` footnotes. Verification is one `read_knowledge` call.

## Knowledge suggestions (web app)

Agents propose knowledge via `suggest_knowledge`. Proposals land in the active brain's review queue. Nothing is written until a human approves. Suggestions are stored in the Postgres `suggestions` table, keyed by `brain_id` and `org_id`.

```
Agent (Cursor / Claude Desktop / Devin / etc.)
    │  suggest_knowledge(...)  →  /brain/<brain_id>/mcp
    ▼
MCP (Lambda, brain resolved from URL path)
    │  insert status=pending  →  that brain's suggestions table
    ▼
Web admin UI → /suggestions tab (scoped to active brain)
    │
    ├─ filter by status: pending / accepted / rejected / all
    ├─ click a row → drawer:
    │     ├─ update case  →  side-by-side diff (existing vs proposed)
    │     └─ new doc case →  rendered preview + editable destination path
    └─ Approve  → writes to that brain's S3 bucket → auto-ingests → queryable
       Reject   → marks rejected (kept for audit)
```

### When an agent should call it

- Discovered a new fact or pattern worth preserving
- Caught an inaccuracy in an existing doc
- Found a missing cross-reference
- Has a clearer explanation of something already covered

### What the reviewer sees

- Trigger, for example "when querying amplia", or the title if no trigger was given
- Content preview plus full rationale in the detail drawer
- For updates, a diff of the current file vs the proposed replacement
- For new docs, the rendered markdown plus an editable destination path. Defaults to a slugified title at root. Override with a subfolder like `databases/my-doc.md`

### Useful to know

- Approving writes the full proposed content to S3. The agent is expected to produce a drop-in replacement, not a patch.
- Rejecting does not delete the row. It stays with `status=rejected` for audit.
- The Postgres `suggestions` table indexes by `brain_id`, `status`, and `created_at`.
- Approval triggers the S3 to auto-ingest Lambda to Bedrock ingestion pipeline. Approved suggestions are retrievable via `search_knowledge` within about 1 minute.

## Data source connectors

Connect a Google Sheet, Doc, Slides deck, Notion page or database, or GitHub repo from the Sources tab. A connector belongs to one brain, the brain that is active in the header when you click Add new source. The connector row lives in that brain's connectors table and writes its files into that brain's docs bucket under `sources/<type>/<slug>/…`. Re-syncing happens every 6 hours.

Each connection authenticates once. OAuth for Google and Notion. A GitHub App installation or PAT for GitHub. OAuth and PAT credentials live in Secrets Manager. GitHub App installations are bound to a Context101 organization in Postgres and mint short-lived tokens when needed.

### User flow

1. Sign in to the web app. Click Sources in the header.
2. Click Add new source, then pick a provider.
3. Paste the URL plus a friendly label. For GitHub, connect the GitHub App once, choose a granted repository, and optionally enter path filters. A Personal Access Token remains available as a fallback.
4. OAuth providers show a consent screen. Google uses read-only scopes. Notion lets you pick which pages the integration can see. GitHub asks which account and repositories the app may read.
5. You land back on `/sources`. The connector shows `syncing`. The card polls every 5s and flips to `connected` once the first sync finishes.
6. Added by shows the user identity that created it. Google account, Notion workspace, or GitHub user shows which provider identity authenticated. Sync now and Remove live on each card.

### What each connector does

| Type | API | Rendering | S3 layout |
|------|-----|-----------|-----------|
| Sheets | `spreadsheets.get` + `values.get` per tab | One markdown table per tab | `sources/sheets/<spreadsheet-slug>/<tab-slug>.md` |
| Docs | `documents.get` | Walks `body.content` into headings, lists, tables | `sources/docs/<doc-slug>/content.md` |
| Slides | `presentations.get` | Slide title, bullets, speaker notes | `sources/slides/<deck-slug>/content.md` |
| Notion | `pages.retrieve` or `databases.query` plus recursive `blocks.children.list` | Block tree into paragraphs, headings, lists, tables, code, to-dos, callouts | `sources/notion/<workspace-slug>/<page-slug>.md`. One file per page. Databases unfold to one file per row |
| GitHub | `git/trees/{branch}?recursive=1` plus `git/blobs/{sha}` per file | Markdown passthrough. Code wrapped in fenced language blocks. Filters: extension allowlist, path-segment denylist (`node_modules/`, `dist/`, `.git/`, and similar), 200KB max | `sources/github/<owner-repo-slug>/<path>.md`. One file per repo file, original tree preserved |

Every file gets a `.metadata.json` sidecar tagged `source=<type>`, `connector_id=<uuid>`, and resource IDs so later filters can trace back to the exact connector.

### Non-native files (uploaded .xlsx / .docx / .pptx)

Files uploaded to Drive but never converted to native Google formats are rejected by the corresponding Google API. The Sheets API will not read an uploaded `.xlsm`. The connector surfaces this as a clear error on the card:

> This looks like an uploaded Excel file (.xlsx/.xlsm/.ods), not a native Google Sheet. In the Sheet, go File, then Save as Google Sheets, then retry with the new URL.

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
       ▼                  ▼                  ▼                  ▼                  ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  sync-sheets │   │  sync-docs   │   │  sync-slides │   │  sync-notion │   │  sync-github │
│              │   │              │   │              │   │              │   │              │
│ Google OAuth │   │ Google OAuth │   │ Google OAuth │   │ Notion OAuth │   │ GitHub App / │
│  (refresh)   │   │  (refresh)   │   │  (refresh)   │   │  (long-lived │   │ PAT fallback │
│              │   │              │   │              │   │   access tok)│   │   no OAuth)  │
│ spreadsheets │   │ documents.get│   │ presentations│   │ pages /      │   │ git/trees +  │
│ + values × N │   │ → md (tables,│   │ .get → md    │   │ databases +  │   │ git/blobs    │
│ → md tables  │   │   lists,     │   │ (title,      │   │ blocks tree  │   │ → md (.md    │
│              │   │   headings)  │   │  notes)      │   │ → md         │   │  passthru,   │
│              │   │              │   │              │   │              │   │  code fenced)│
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                  │                  │                  │
       └──────────────────┴──────────────────┴──────────────────┴──────────────────┘
                                              │
                                              ▼
                       ┌────────────────────────────────────────────┐
                       │  S3 docs bucket (sources/<type>/…)         │
                       └──────────────────┬─────────────────────────┘
                                          │  S3 PutObject
                                          ▼
                                auto-ingest Lambda → Bedrock KB
```

Successful GitHub sync used to be able to fire `start-wiki-gen` in code mode when `AUTO_TRIGGER_CODE_WIKI=true`. Leave that off. Wiki generation is paused. Sources still sync into `sources/github/<repo>/` every 6 hours.

### OAuth setup (one-time per provider)

Both providers use the same redirect URI pattern:

```
https://<WebAppDefaultDomain>/api/connectors/oauth/callback
```

`<WebAppDefaultDomain>` is the Amplify URL from your stack outputs, for example `main.abc123.amplifyapp.com`. The callback route derives the public origin from `x-forwarded-host`, so it works on prod without an `APP_BASE_URL` env var. The exact URL above has to be registered in each provider's console before consent will succeed.

#### Google (Sheets / Docs / Slides)

1. GCP Console, APIs & Services, Credentials, then Create credentials, then OAuth client ID, then Web application.
2. Authorized JavaScript origins: `https://main.<amplify-app-id>.amplifyapp.com`
3. Authorized redirect URIs: `https://main.<amplify-app-id>.amplifyapp.com/api/connectors/oauth/callback`
4. APIs & Services, Library. Enable each API you want:
   - Google Sheets API
   - Google Docs API
   - Google Slides API
   - Google Drive API, used for `drive.metadata.readonly` so we can show titles
5. OAuth consent screen. Configure as Internal (Google Workspace domain) or External. External apps need verification before going past about 100 users. Internal is fine for a single-workspace team.
6. Store the client creds:

   ```bash
   aws secretsmanager create-secret \
     --name context101-google-oauth-client \
     --secret-string '{"client_id":"…apps.googleusercontent.com","client_secret":"GOCSPX-…"}' \
     --region [REDACTED]
   ```

#### Notion

1. Go to https://www.notion.so/profile/integrations. Build in the left sidebar, then Public connections, then New public connection.
   - Must be Public, not Internal. Internal integrations use a static workspace token. Only public integrations expose an OAuth client ID and secret.
2. Basic information. Name it `Context101`. Set installation scope. Add an icon if you want.
3. Capabilities. Check Read content only. Uncheck Update, Insert, and Comment.
4. OAuth Domain & URIs. Add:
   - Redirect URI: `https://main.<amplify-app-id>.amplifyapp.com/api/connectors/oauth/callback`
5. Grab the OAuth client ID (UUID, for example `34cd872b-594c-81eb-…`) and OAuth client secret (starts with `secret_…` or `ntn_…`) from the same page.
6. Store the creds:

   ```bash
   aws secretsmanager create-secret \
     --name context101-notion-oauth-client \
     --secret-string '{"client_id":"<UUID>","client_secret":"secret_…"}' \
     --region [REDACTED]
   ```

CDK references both secrets by name (`secretsmanager.Secret.fromSecretNameV2`). You can rotate values without re-running `context101 deploy`. Add a new JSON version and the next sync picks it up.

#### GitHub via the GitHub App (recommended, tokenless)

Register one GitHub App for the deployment. Each Context101 organization then connects its own GitHub account or organization and chooses which repositories the app may read.

1. An instance admin temporarily sets `GITHUB_APP_MANIFEST_SETUP_ENABLED=true` in production and opens `/api/connectors/github-app/create`. This uses GitHub's [app-manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest) to create a public-installable app with read-only Contents and Metadata permissions. The credentials land in the `context101-connector-github-app` secret automatically. Disable the setup flag afterward. An existing app cannot be overwritten through this route.
2. A user clicks Connect GitHub in the add-source dialog. GitHub asks which personal account or organization to connect and whether to grant all or selected repositories. Context101 verifies the installer through the GitHub App user-authorization flow, then binds that installation to the active Context101 organization.
3. The dialog lists the repositories granted to that organization. Choose one, optionally enter path filters, and start the sync. No long-lived user token is stored.
4. The sync Lambda mints a fresh 1-hour installation token from the app's private key on every run. Revoke or audit access from GitHub, Settings, Installed GitHub Apps.

For an app created before this multi-organization flow, update its GitHub App settings once. Enable Any account under installation availability and add `https://<your-host>/api/connectors/github-app/oauth-callback` as a callback URL. New apps created by the manifest include both settings.

Installation IDs are stored per Context101 organization in `github_app_installations`. Multiple users and GitHub organizations can share one self-hosted Context101 deployment.

#### GitHub via Personal Access Token (legacy fallback)

The dialog always offers a PAT fallback. Use it when the GitHub App is not configured, cannot be installed by the current user, or does not have access to the required repository. It is stored in the per-connector secret (`context101-connector-<uuid>`) as `{ "github_pat": "…" }`.

Generate the token at https://github.com/settings/tokens. Two flavors work:

- Fine-grained, recommended. Pick Only select repositories, choose the repos you want to sync, and grant Repository, Contents, Read-only. Tied to specific repos. Expires on a schedule you set.
- Classic. `repo` scope for private repos, or `public_repo` for public only. Broader access. Lasts until you revoke it.

Do not paste `gho_…` tokens from `gh auth token`. Those are the gh CLI's OAuth tokens and rotate when gh refreshes them, which breaks the connector with 401s on the next sync.

##### Path scoping

By default a GitHub connection syncs the whole repo, minus the built-in lockfile, `node_modules`, and build exclusions. The Paths to sync field in the add dialog narrows a connection to specific folders, files, or globs. One per line, relative to the repo root:

```
apps/plateapr.com/docs/analytics/     ← a folder (everything under it)
README.md                             ← an exact file
apps/*/docs/**                        ← a glob (* stays in one path segment, ** crosses)
```

Only matching files are pulled, pruned, and counted. The scope lives in the connector row's `metadata.paths`.

Multiple connections per repo. You can add several connections to the same repo, each scoped to different paths, for example one for `apps/plateapr.com/docs/` and another for `packages/analytics/`. They all write into the shared `sources/github/<owner>-<repo>/` prefix. The synced tree is the union of every connection's scope. Each connection only prunes or deletes files inside its own scope. Deleting one connection removes only the files it wrote, matched via the `connector_id` in each file's metadata sidecar.

### Notion auth model vs Google

Google returns a refresh token. Access tokens expire every hour. We refresh on each sync. Notion returns a long-lived access token, no expiry, no refresh flow. Both land in the same per-connector secret (`context101-connector-<uuid>`) with different shapes:

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

`connector-sync-sheets`, `docs`, and `slides` refresh the Google token via `oauth2.googleapis.com/token`. `connector-sync-notion` uses the access token directly as `Authorization: Bearer …` with `Notion-Version: 2022-06-28`.

### Connector states

| Status | Meaning |
|---|---|
| `pending_auth` | Row created, user has not completed Google consent yet |
| `syncing` | Sync Lambda is running |
| `connected` | Last sync succeeded. `last_synced_at`, `item_count`, `resource_title` are populated |
| `error` | Last sync failed. `last_error` shows the message inline on the card |

Connectors in both `connected` and `error` states are retried on every 6h tick. The dispatcher does not give up after a single failure.

### Remove a connector

Click the trash icon on the card, then confirm. This:

1. Deletes the refresh-token secret, force delete, no recovery window.
2. Deletes every S3 object under `sources/<type>/<slug>/` in the docs bucket.
3. Deletes the connector row from Postgres.

Bedrock auto-reindexes on the S3 delete events. Within a minute the content is gone from `search_knowledge` too.

## Improve with AI (web app)

Open any `.md` file in the admin UI and click Improve. The current document goes to Claude Opus 4.7 via Amazon Bedrock (`us.anthropic.claude-opus-4-7`), which returns a rewritten version plus a summary of what changed. You see a side-by-side diff and choose Accept & save or Cancel.

The system prompt constrains the model to:

- Never invent facts, IDs, URLs, schema details, or technical terms. Preserve every concrete value from the original.
- Keep the author's voice. Do not formalize or casualize.
- Keep markdown valid. GFM, fenced code blocks, heading hierarchy.
- Allowed: fix typos, split long paragraphs, clarify headings, convert prose and lists or tables where it helps scannability, rewrite ambiguous sentences, add a one-line opening summary if missing.

Cost is about $0.02 to $0.05 per call on a typical 10KB doc. Nothing is written to S3 unless you Accept.

Requires on the AWS account:

- Bedrock model access granted for Claude Opus 4.7. One-time: `aws bedrock create-foundation-model-agreement`
- `bedrock:InvokeModel` plus `aws-marketplace:*` on the Amplify SSR compute role. CDK handles this.

## Auto-generated wiki (paused, optional beta)

Wiki generation is paused. Retrieval is raw-first and does not depend on these pages. Keep this section for operators who still want the optional beta. Do not treat the wiki as the product.

A Fargate task can read the active brain's corpus and write a cross-referenced wiki under `wiki/` in that brain's docs bucket. The admin UI's Wiki tab renders it read-only with Mermaid diagrams and source citations back to the original markdown.

The same Fargate task definition handles every brain. `start-wiki-gen` reads the brain id from the request. The `/wiki` Refresh now button passes the active brain, looks up the brain's `docs_bucket`, and injects it via `containerOverrides.environment`. Single-flight dedup keys on `(brain_id, mode, repo)` so a refresh on Brain A does not collide with a refresh on Brain B.

CDK deploys the TypeScript image from `wiki-generator-ts/`. The Python tree is gone.

User flow if you turn the optional beta on for one run:

1. Sign in and click Wiki in the header.
2. Left sidebar lists pages. Main pane renders the selected page.
3. Right-side card shows Last indexed and a Refresh now button. One click triggers a regen and polls until it finishes, about 1 to 3 minutes.

The EventBridge rule `WikiGenSchedule` exists with `enabled: false`. Leave it disabled. Do not flip it on. Do not set `AUTO_TRIGGER_CODE_WIKI`. Manual Refresh now still works because it calls `start-wiki-gen` directly.

What gets written to S3 when a run finishes:

- `wiki/<slug>.md`. One page per topic, full markdown with Mermaid blocks and `Sources: [file.md]()` citations
- `wiki/<slug>.md.metadata.json`. Bedrock KB sidecar tagging the page `source=wiki`, plus `generated_at`, `page_slug`, `source_files`. See [Raw-first retrieval](#raw-first-retrieval)
- `wiki/_index.json`. Nav order, titles, descriptions, source mappings per page
- `wiki/_meta.json`. Timestamps, page and source counts, and `corpus_sha`

Generated pages land in the same bucket as raw docs. Auto-ingest picks them up the same way. At retrieval time they sit in the same search pool as raw docs. `search_knowledge` returns both. Only code (`source=github` / `source=code-wiki`) is filtered out.

Cost is about $0.30 to $0.80 per full regen, one Opus call for the structure plus one per page. Fargate runtime is about 3 to 5 minutes at roughly $0.04/hr for a 0.5 vCPU / 1 GB task.

### Manual-only regen and no-change guard

Wiki regen stays off the schedule. The team-wiki EventBridge rule (`WikiGenSchedule`) is created with `enabled: false`. The GitHub connector's auto-fire after sync is gated on `AUTO_TRIGGER_CODE_WIKI`. Leave that unset or false.

- Team wiki regenerates only when a human clicks Refresh now on `/wiki`.
- Code wikis regenerate only via the manual `start-wiki-gen` invoke below.

Do not re-enable the schedule in `cdk/lib/context101-stack.ts`. Do not set `AUTO_TRIGGER_CODE_WIKI=true` on `connector-sync-github`.

The cost-saving plumbing still matters for a manual run:

- Each successful regen records a corpus fingerprint in `wiki/_meta.json`. SHA-256 over sorted `(key, ETag)` pairs of every input file. Mode-aware. Main mode hashes the whole bucket excluding top-level `wiki/<slug>.md`. Code mode hashes `sources/github/<repo-slug>/`. ETags are MD5s S3 already computes, so the hash needs no body downloads. One `ListObjectsV2` paginate is enough.
- A run lists the corpus, computes the new fingerprint, reads the old one from `_meta.json`. Same hash exits 0 without calling Opus. A no-op invocation costs about 3 to 5 seconds of Fargate boot plus 1 or 2 S3 calls. Nothing is overwritten.
- Manual Refresh now passes `WIKI_FORCE=1` to the container via `start-wiki-gen` Lambda `containerOverrides.environment`, which bypasses the guard.
  - User click is forced and always regenerates. Use this after you edit prompts in `wiki-generator-ts/src/prompts/`.
  - A re-enabled schedule or auto-fire would be guarded. Do not turn those back on.
  - A GitHub-sync invocation, if auto-fire were on, would be unguarded but the corpus just changed, so the hash differs. The github connector's tree-SHA gate already filters unchanged-repo invocations one layer up.

Existing `wiki/_meta.json` files without a `corpus_sha` field are treated as no prior hash, so they regenerate. The next run populates the field. No backfill needed.

### Single-flight without duplicate Fargate tasks

Two users clicking Refresh now at the same time will not spawn duplicate tasks. The dispatcher Lambda (`start-wiki-gen`) inspects the wiki cluster via `ecs:ListTasks` and `ecs:DescribeTasks` before each `RunTask`, matching by `WIKI_MODE` and, for code mode, `REPO_FULL_NAME` env overrides. If a matching task is already running or pending, it returns that task's ARN with `alreadyRunning: true`. The second clicker attaches to the same regen.

On `/wiki` page-mount the UI issues `GET /api/wiki/refresh?check=1`, which invokes the dispatcher in `checkOnly` mode. Same dedup query, no `RunTask`. If a regen is in flight, the page enters the Regenerating state and polls until the task stops. Refreshing the page, opening it from another browser, or a teammate landing on `/wiki` all converge on the same task ARN. The button stays disabled until the regen finishes.

ECS is the source of truth. There is no separate lock store. A crashed task disappears from `ListTasks`. No zombie locks to clear. The race window for two near-simultaneous Lambda invocations seeing no running task before either `RunTask` is visible is hundreds of milliseconds. Acceptable for a UX dedup. An S3 conditional `IfNoneMatch:'*'` lock file is the obvious upgrade if that ever becomes a real problem.

### Run the generator locally

```bash
cd wiki-generator-ts
npm install

AWS_REGION=[REDACTED] \
DOCS_BUCKET=<DocsBucketName> \
npm run dev
```

Optional env knobs: `WIKI_PREFIX` (default `wiki/`), `MODEL_ID` (default `us.anthropic.claude-opus-4-7`), `MIN_PAGES` / `MAX_PAGES` (default 4 / 8), `CORPUS_PREVIEW_CHARS` (default 600, how much of each source doc feeds into the structure call), `MAX_TOKENS` (default 8192 per Opus call), `WIKI_FORCE=1` to bypass the corpus-hash guard. See [`wiki-generator-ts/README.md`](./wiki-generator-ts/README.md) for provider flags and incremental options.

Set `WIKI_PREFIX=wiki-preview/` to iterate on prompts without overwriting the live wiki.

## Per-repo code wikis (optional beta)

Paused with the rest of wiki generation. Connecting a GitHub repo still syncs files. It does not auto-synthesize a code wiki.

If you run a manual code-mode regen, you get two layers:

1. Layer 1, code in the team wiki. `connector-sync-github` writes every code file to `sources/github/<repo-slug>/<path>.md`. A later team-wiki regen can read them as part of the corpus, alongside Notion, Sheets, Docs, and Slides.
2. Layer 2, a dedicated code wiki per repo at `wiki/code/<repo-slug>/<page>.md`. The same Fargate task runs in code mode with architecture-oriented prompts. Output is tagged `source=code-wiki` in the sidecar.

```
┌────────────────────────────────────────────────────────────────────────┐
│  Top-level reconciled wiki        wiki/<slug>.md                        │  ← search_knowledge can return this
│  (cites everything below)                                               │
└────────────────────────────────┬───────────────────────────────────────┘
              cites both ▼                  ▼
┌──────────────────────────────────┐  ┌────────────────────────────────┐
│  Per-repo code wiki              │  │  Team raw sources              │
│  wiki/code/<repo-slug>/<page>.md │  │  sources/sheets/…              │
│  source=code-wiki                │  │  sources/docs/…                │
│  (Layer 2)                       │  │  sources/slides/…              │
└────────────────┬─────────────────┘  │  sources/notion/…              │
                 │ reads from         └────────────────────────────────┘
                 ▼                                   ▲
┌──────────────────────────────────┐                │
│  Raw GitHub sources              │ ◄──────────────┘  same KB,
│  sources/github/<repo-slug>/…    │   same auto-ingest pipeline
│  (Layer 1, connector output)     │
└──────────────────────────────────┘
```

### What gets retrieved when

- `search_knowledge(query)` returns raw-doc chunks and top-level wiki chunks if they exist. Raw GitHub sources (`source=github`) and code-wiki pages (`source=code-wiki`) stay in the index but are filtered out so they do not dominate results.
- The team wiki's structure prompt can see `wiki/code/<repo-slug>/<page>.md` files in its corpus and cite them.
- `read_knowledge(s3_key)` reads a code-wiki page or a raw `sources/github/…` file when an agent needs more than the team wiki cited.

### One Fargate task, two modes

`wiki-generator-ts` switches behavior on `WIKI_MODE`:

| Env | `main` (default) | `code` |
|---|---|---|
| Corpus | whole bucket, excludes top-level `wiki/<slug>.md`, keeps `wiki/code/…` in scope | scoped to `CORPUS_PREFIX=sources/github/<repo-slug>/` |
| Output | `wiki/<slug>.md` | `wiki/code/<repo-slug>/<slug>.md` |
| Prompts | `STRUCTURE_PROMPT` + `PAGE_PROMPT` (team docs) | `CODE_STRUCTURE_PROMPT` + `CODE_PAGE_PROMPT` (architecture, data flow, module diagrams) |
| Sidecar `source` | `wiki` | `code-wiki` |

The same `start-wiki-gen` Lambda starts both. SSR `/api/wiki/refresh` invokes it with `{}` for main mode. A manual invoke can pass `{ mode: "code", repo: "owner/repo" }`. `containerOverrides.environment` carries the per-task env diffs.

### Costs and auto-trigger gating

A code-wiki regen costs about $0.30 to $0.80 in Opus calls, one structure call plus one per page, plus about 3 to 5 minutes of Fargate at about $0.04/hr.

Do not set `AUTO_TRIGGER_CODE_WIKI=true` on `connector-sync-github`. Code wikis regenerate only when you invoke `start-wiki-gen` yourself. Sources still sync content into `sources/github/<repo>/` every 6 hours. Only the Opus synthesis is gated.

If someone had previously turned auto-trigger on, a tree-SHA cost guard was the throttle:

- Each successful github sync records the GitHub tree SHA on `row.last_synced_tree_sha`. The SHA of the repo's tree object at HEAD, deterministic from file structure plus blob contents.
- The next sync compares against the stored value. Same SHA skips the code-wiki dispatch. Files are still re-PUT to S3. Only the Opus regen is gated.
- The sync's return value includes `tree_changed` and `code_wiki_fired` so you can see what happened in CloudWatch.

Leave auto-trigger off. The tree-SHA field is still useful as a change detector for scoped connections.

### Browsing code wikis in the UI

The `/wiki` page sidebar has two groups:

- Team wiki. Top-level synthesis under `wiki/<slug>.md`.
- Code wikis. One collapsible section per connected GitHub repo. Pages come from `wiki/code/<repo-slug>/_index.json`. Click a repo's name to expand its pages.

Selecting a code-wiki page swaps the right-side meta panel to that repo's `last_indexed` plus page count. The Refresh now button is hidden for code wikis. To regenerate a code wiki, invoke `start-wiki-gen` manually with `{ mode: "code", repo: "owner/repo" }`.

Selection state in the URL is not persisted. Refreshing the page resets to the first team-wiki page.

### Manually invoking a code-wiki regen

```bash
aws lambda invoke \
  --function-name context101-start-wiki-gen \
  --payload '{"mode":"code","repo":"owner/repo"}' \
  --cli-binary-format raw-in-base64-out /dev/stdout \
  --region [REDACTED]
```

Watch the Fargate task in the AWS console under ECS, `context101-wiki` cluster. It writes to `wiki/code/<owner-repo-slug>/`. Pages are retrievable via `read_knowledge` immediately and can surface in a later team-wiki regen.

## How it works under the hood

### Ingestion from markdown to vectors

```
knowledge/databases.md                   (local markdown)
         │
         │  context101 deploy --seed (BucketDeployment)
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

Why 20% overlap? A question whose answer spans a chunk boundary can still retrieve a chunk that contains the full answer.

Why non-filterable metadata? S3 Vectors caps filterable metadata at 2KB per vector. Bedrock stores the raw chunk text under `AMAZON_BEDROCK_TEXT`. Long chunks would blow past the cap. We mark that key and `AMAZON_BEDROCK_METADATA` non-filterable so they do not count against the cap. They are still retrievable. You just cannot use them as filter predicates.

### Retrieval from query to top-K chunks

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
     • score     (0.0 to 1.0)
             │
             ▼
   agent may call read_knowledge(key)
   if it needs the full source doc
```

### Wiki generation from corpus to synthesized pages

Optional beta. The EventBridge 10h rule exists and stays disabled. A web UI click still starts the same task.

```
                               ┌────────────────────────┐
                               │  EventBridge (10h, off)│
    ┌──────────────────────────┤  OR  web UI click      │
    │                          │  → ecs:RunTask         │
    ▼                          └────────────────────────┘
┌──────────────────┐
│  Fargate task    │   (0.5 vCPU, ~3-5 min)
│  generate.ts     │
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
       (same pipeline as raw docs. wiki pages
        become retrievable via search_knowledge)
```

Why two LLM calls instead of one? The structure call plans topically using filenames plus the first N chars of each source. Cheap, wide context. The per-page call gets the full content of that page's `relevant_files`. Deep context, narrow scope. Generating the whole wiki in one prompt would blow the context window past a handful of docs and produce worse structure.

Why XML for the plan? Nested lists of lists, sections to pages to `relevant_files` plus `related_pages`, serialize cleanly in XML. Opus emits it reliably without JSON-mode. The XML is scratch. Only the generated markdown lands in S3.

Source citations. Each page's per-page prompt requires `Sources: [file.md]()` lines under every claim. Combined with the `sources[]` array in `_index.json`, this gives the Wiki tab the Synthesized from footer and keeps the provenance chain back to the raw docs.

## Cleanup

Tear down a single brain. Click delete on its row in `/brains` and confirm by typing the display name. The provisioner empties the bucket, deletes the KB, vector index, and token secret, and removes the Postgres `brains` row. The default brain cannot be deleted this way.

Tear down the whole stack:

```bash
context101 list
context101 destroy Context101Stack
```

The default brain's docs bucket and the shared S3 Vectors bucket have `RETAIN` policies, so destroy leaves their data behind. Empty them manually if you want them gone. Non-default brains created at runtime are not in CloudFormation. They were provisioned by the brain-provisioner Lambda. Destroy does not clean them up. Delete them from `/brains` first, or sweep the `context101-brain-*` buckets, KBs, and secrets yourself.

## Why this stack

- S3 Vectors. Cheap vector store. Stays inside S3. One index per brain inside a shared vector bucket.
- Titan embed v2, 1024-dim. Native to Bedrock. No third-party API keys.
- Lambda plus CloudFront. One stable TLS URL serving every brain. Scale-to-zero, about $0/mo idle, does not grow with brain count. The same container image also runs on leftover App Runner during migration.
- Per-brain bearer tokens. Each brain has its own Secrets Manager secret. Compromise of one brain's token does not touch others.
- Postgres control plane. Better Auth plus app tables for brains, connectors, suggestions, and MCP token hashes.

## Notes

- `removalPolicy: RETAIN` on the default docs bucket and the shared vector bucket. Accidental destroy will not wipe your data. Runtime-created brain buckets follow the same convention.
- The MCP server does not write to a KB directly. Agents propose via `suggest_knowledge`, which lands in the active brain's review queue. Content flows into S3 through the web UI, approved suggestions, or the data connectors.
- Each S3 upload triggers an ingestion job for the bucket's brain. The auto-ingest Lambda still uses the leftover brain registry during the transition. The web and MCP read path can resolve brains from Postgres.
- To rotate the default brain's bearer token: `context101 config set CTX_TOKEN=…` and re-run `context101 deploy`. For other brains: `aws secretsmanager put-secret-value --secret-id context101-brain-<id>-token --secret-string '<new-value>'`. The MCP cache picks up the new value within about 5 minutes.
- The wiki generator writes one file per page per run, so a full regen kicks N ingestion jobs in rapid succession. Bedrock dedups internally. Safe, noisy in the console.

## Roadmap

- Per-brain RBAC. Better Auth organizations are in place. Per-brain roles are still a follow-up. Do not assume they exist.
- Per-user MCP auth. Graduate from per-brain bearer tokens once you need per-person audit trails. The current MCP path validates hashed bearer tokens in Postgres when configured.
- Sub-brain metadata filters. Within one brain, scope queries with metadata sidecars (`team`, `freshness`, `audience`). Already partly wired via the `source` sidecar filter. Search excludes `github` and `code-wiki`. Extend `search_knowledge` with an optional `filter` arg and compose it via Bedrock's `andAll`.
- GitHub App flow is done. See [GitHub via the GitHub App](#github-via-the-github-app-recommended-tokenless). Registered per deployment via the app-manifest flow, per-repo install consent, short-lived installation tokens minted per sync, PAT path kept as fallback.
- Chat connector, Slack or Discord. Ingest pinned messages plus specific channel transcripts into `sources/chat/<channel>/<day>.md`.
- Per-page code-wiki cache. Today the cost guard skips the entire code-wiki regen when the repo's tree SHA has not moved. A finer version would cache each page by the hash of its `relevant_files`.
- Deep links to wiki pages, `/wiki?repo=foo-bar&slug=architecture`, to restore selection across reloads.
- Per-folder descriptions. Drop a `_about.md` in each folder that explains what the folder is for. Bedrock indexes it like any other markdown.
- Hierarchical or semantic chunking. Better retrieval on long, structured docs. Higher ingestion cost.
- Multimodal ingestion. Bedrock KB supports images and tables via `SupplementalDataStorageLocation`.
- App Runner to Lambda plus CloudFront is done for new deploys. Remaining follow-up is deleting the leftover App Runner block from the stack once every deployment has cut over. See [Migrating an existing deployment off App Runner](#migrating-an-existing-deployment-off-app-runner).
