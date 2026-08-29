# Context101

<p align="center">
  <img src="https://shieldcn.dev/badge/status-alpha.svg?variant=secondary" alt="Alpha" />
  <img src="https://shieldcn.dev/badge/license-MIT.svg?variant=outline" alt="MIT License" />
  <img src="https://shieldcn.dev/badge/protocol-MCP.svg?variant=default" alt="MCP" />
  <img src="https://shieldcn.dev/badge/Amazon_Bedrock.svg?variant=branded&logo=amazonaws" alt="Amazon Bedrock" />
  <img src="https://shieldcn.dev/badge/Next.js.svg?variant=branded&logo=nextdotjs" alt="Next.js" />
  <img src="https://shieldcn.dev/badge/Postgres.svg?variant=branded&logo=postgresql" alt="Postgres" />
  <img src="https://shieldcn.dev/badge/TypeScript.svg?variant=branded&logo=typescript" alt="TypeScript" />
</p>

An open-source, self-hosted **MCP knowledge base** for trusted internal teams. Backed by **Amazon Bedrock Knowledge Bases** (S3 + S3 Vectors) for content and retrieval, with a **Better Auth + Postgres** control plane.

Create **as many brains as you want** from the web admin UI. Each brain is a fully isolated knowledge base — its own S3 bucket, Bedrock KB, vector index, suggestions queue, and bearer token. One MCP service serves them all; clients reach a specific brain at `/brain/<brain_id>/mcp`.

> **⚠️ Alpha.** Built as an internal proof of concept. Good for self-hosted, trusted-team deployments — **not** production SaaS or public multi-tenant hosting. Read [ALPHA.md](./ALPHA.md) before deploying with sensitive data.

## Architecture

```
 Claude · Cursor · Claude Code · …
        │  /brain/<id>/mcp + per-brain bearer token
        ▼
 ┌─────────────────────┐
 │ App Runner          │  one TLS URL; brain resolved from URL path
 │ FastMCP (server.py) │
 └──────────┬──────────┘
            ▼
 ┌─────────────────────┐
 │ Postgres control    │  orgs, brains, connectors, suggestions,
 │ plane (Better Auth) │  MCP token hashes
 └──────────┬──────────┘
            ▼  per brain:
   Bedrock KB  ·  S3 docs bucket  ·  S3 Vectors index  ·  token secret
            ▲
   S3 PutObject → auto-ingest Lambda → Bedrock StartIngestionJob
```

The control plane lives entirely in Postgres. Brain create/delete/re-embed runs at runtime through `BrainProvisionerFn`; `cdk deploy` is reserved for infra changes. Each brain picks its own embedding model — **Amazon Titan or Cohere** — at creation or from **Settings → Embeddings**; changing it re-embeds the brain in place (fresh KB/index, docs copied over, atomic repoint) while preserving the brain id, token, and MCP URL.

## MCP tools

All tools operate on the brain in the URL path; reads and queries are scoped to that brain.

| Tool | Purpose |
|------|---------|
| `search_knowledge(query, limit=5)` | Semantic search over the brain's **canonical wiki** — synthesized, deduplicated pages |
| `read_knowledge(s3_key)` | Full content of any doc (raw or wiki) — the ground-truth escape hatch |
| `list_sources()` | Enumerate every document in the brain's docs bucket |
| `suggest_knowledge(title, content, …)` | Propose a doc/update → human review queue; never writes directly |

**Two-tier retrieval:** raw sources (`knowledge/`, connector output) are embedded but filtered out of `search_knowledge`; only synthesized `wiki/` pages (tagged `source=wiki` via a `.metadata.json` sidecar) are returned. This avoids duplicate hits, reconciles conflicting sources, and keeps every chunk traceable back to its raw docs.

## Quick start

**Prerequisites:** AWS CLI v2 (`us-east-1`), Node 20+, Docker, Python 3.11+, a forked repo, and Bedrock model access for `amazon.titan-embed-text-v2:0` (embeddings) and `us.anthropic.claude-opus-4-7` (*Improve with AI* + wiki). A Postgres database (Neon, Supabase, RDS/Aurora, or local).

```bash
# 1. One-time
npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
cp cdk/.deploy-env.example cdk/.deploy-env && $EDITOR cdk/.deploy-env   # set CTX_TOKEN, DB + auth vars
chmod 600 cdk/.deploy-env

# 2. Deploy (infra + MCP service + web admin UI)
cd cdk && npm install && ./deploy.sh        # add --seed to bootstrap the default brain from knowledge/
```

> 🛡️ **Always deploy through `./cdk/deploy.sh`.** A bare `cdk deploy` without the gating tokens (`CTX_TOKEN`, `CTX_GH_TOKEN`) tells CloudFormation the App Runner + Amplify resources should no longer exist — and deletes them. The wrapper refuses to run without both (GitHub PAT falls back to `gh auth token`).

Apply the control-plane schema with `npm run db:migrate` from `web/`. Save the `McpUrl` and `WebAppDefaultDomain` outputs. The first Amplify build takes ~4 min; if CDK added new env vars during the deploy, kick one more build (`aws amplify start-job --app-id <id> --branch-name main --job-type RELEASE`).

For **self-hosted** auth, visit `/setup` to create the first Better Auth user + org, then invite teammates. Required env vars (in `.deploy-env`): `DATABASE_URL`, `DATABASE_DRIVER`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `MCP_TOKEN_PEPPER`, and `SES_*` for transactional email. (Supabase pooler URLs need `DATABASE_PREPARE=false`.)

### Connect an MCP client

Grab the per-brain URL + token from the **About** page in the admin UI.

```json
// Cursor — .cursor/mcp.json
{
  "mcpServers": {
    "context101": {
      "url": "https://<McpHost>/brain/<brain_id>/mcp",
      "headers": { "Authorization": "Bearer <per-brain-token>" }
    }
  }
}
```

Claude Desktop speaks MCP over stdio only — wrap the URL with `npx -y mcp-remote <url> --header "Authorization: Bearer <token>"`. Use a distinct `mcpServers` key per brain to attach to several at once.

## Managing brains

From **Brains** in the header: **+ New brain** provisions a fully isolated KB in ~30–60s (`status: provisioning → ready`). The header switcher scopes every tab (Files, Wiki, Suggestions, Sources) to the active brain; selection rides the `ctx_brain` cookie / `?brain=<id>` query param. Deleting a brain empties + removes its bucket, KB, vector index, and token secret (the `default` brain is protected).

**Idle cost:** S3 + Bedrock KB + Vectors are ~$0/mo idle (pay-per-query); each brain's token secret is ~$0.40/mo; the shared App Runner MCP service is ~$5–15/mo total. A hundred brains cost about the same as one.

## Content flows

Three paths feed a brain's docs bucket — none require a deploy. Every S3 write triggers the auto-ingest Lambda → Bedrock ingestion (retrievable in ~1 min).

1. **Web admin UI** — create/edit/move markdown; **Improve with AI** rewrites a doc with Claude Opus via Bedrock (~$0.02–0.05/call, nothing saved until you accept).
2. **`suggest_knowledge`** — agents propose docs/updates into the active brain's review queue; nothing lands until a human approves (side-by-side diff for updates, editable destination for new docs).
3. **Data connectors** — sync from where teams already write.

### Connectors

Attach one connector to one brain from the **Sources** tab; re-syncs every 6h. Files land under `sources/<type>/<slug>/…`.

| Type | Auth | Output |
|------|------|--------|
| **Google Sheets / Docs / Slides** | OAuth (read-only) | Markdown tables / prose / slides + notes |
| **Notion** | OAuth (long-lived token) | Block tree → markdown; databases unfold one file per row |
| **GitHub** | Personal Access Token | Code → fenced markdown; extension allowlist, path denylist, 200KB cap |

Google/Notion OAuth client creds live in Secrets Manager (referenced by name, so rotation needs no redeploy); redirect URI is `https://<WebAppDefaultDomain>/api/connectors/oauth/callback`. GitHub takes a fine-grained PAT (Contents: Read-only) directly — avoid `gho_…` tokens from `gh auth token`, which rotate and break sync.

## Auto-generated wiki

A **Fargate task** reads a brain's corpus and synthesizes a cross-referenced, DeepWiki-style wiki under `wiki/` (one Opus call to plan the structure, one per page, with Mermaid diagrams + source citations). The **Wiki** tab renders it read-only; **Refresh now** forces a regen. **Ask the brain** (`/wiki/ask`) is a retrieval playground — it streams a grounded Claude answer alongside the retrieved chunks and similarity scores, so you can judge retrieval quality before/after a re-embed.

- **Manual-only by default** to keep Opus spend predictable; a corpus-hash guard (`wiki/_meta.json`) makes scheduled/auto runs no-op when nothing changed, and single-flight dedup (via `ecs:ListTasks`) prevents duplicate Fargate tasks.
- **Per-repo code wikis** — connecting a GitHub repo also generates a dedicated `wiki/code/<repo>/` (tagged `source=code-wiki`) with architecture/data-flow prompts. Gated behind `AUTO_TRIGGER_CODE_WIKI` (off by default); trigger manually via `start-wiki-gen`.
- **Generator:** the TypeScript generator (`wiki-generator-ts/`) supports `MODEL_PROVIDER=claude-code` or `codex` to run against a **Claude Pro/Max or ChatGPT Plus/Pro subscription** instead of metered Bedrock tokens — the credential is read from a secret and the CLI runs in-container. The original Python generator (`wiki-generator/`) still works against Bedrock. Cost per full regen: ~$0.30–0.80 + a few min of Fargate.

## Repo layout

```
cdk/                  TypeScript CDK — all AWS infra (stack, brain-provisioner,
                      auto-ingest, connector-sync-{sheets,docs,slides,notion,github})
server.py             Python MCP server (FastMCP + Postgres brain routing)
web/                  Deployable Next.js admin app (Amplify Hosting)
site/                 Standalone public marketing site
packages/{design,ui}  Shared design system (npm-workspace monorepo)
wiki-generator/       Python Fargate wiki task (Bedrock)
wiki-generator-ts/    TypeScript wiki task (Bedrock / claude-code / codex)
knowledge/            Optional bootstrap seed for the default brain
```

Self-hosters deploy `web/`; `site/` is the project website and hosts independently.

## Why this stack

- **S3 Vectors** — cheapest vector store; stays inside S3, one index per brain.
- **Bedrock embeddings (Titan / Cohere)** — native to Bedrock, no third-party keys; selectable per brain.
- **App Runner** — one stable TLS URL for every brain, ~$5–15/mo total (doesn't scale with brain count).
- **Per-brain bearer tokens** — hashed in Postgres (`MCP_TOKEN_PEPPER`); one brain's compromise doesn't touch others.

> App Runner is closed to new AWS customers (April 2026). Existing services keep working; [ECS Express Mode](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html) is the eventual successor (~$16/mo ALB add).

## Cleanup

Delete individual brains from `/brains`. Tear down the stack with `cd cdk && ./deploy.sh destroy` — but the default docs bucket and shared vector bucket are `RETAIN` (empty manually), and **runtime-created brains aren't in CloudFormation**, so delete them from `/brains` first or sweep `context101-brain-*` resources by hand.

## Roadmap

Per-brain RBAC · per-user MCP auth · sub-brain metadata filters · GitHub App/OAuth (replacing the PAT) · Slack/Discord chat connector · per-page code-wiki caching · deep links to wiki pages · hierarchical/semantic chunking · multimodal ingestion.

---

See [ALPHA.md](./ALPHA.md), [SECURITY.md](./SECURITY.md), and [CONTRIBUTING.md](./CONTRIBUTING.md). Licensed under [MIT](./LICENSE).
