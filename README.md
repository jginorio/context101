# Context101

![project](https://shieldcn.dev/group/github/stars/jginorio/context101+github/forks/jginorio/context101+github/license/jginorio/context101+github/issues/jginorio/context101.svg?variant=branded)

![status](https://shieldcn.dev/badge/status-alpha-f59e0b.svg?variant=branded)
![bedrock](https://shieldcn.dev/badge/Amazon%20Bedrock-KB%20%2B%20S3%20Vectors-ff9900.svg?variant=branded)
![mcp](https://shieldcn.dev/badge/MCP-FastMCP-6366f1.svg?variant=branded)
![auth](https://shieldcn.dev/badge/Better%20Auth-Postgres-3ecf8e.svg?variant=branded)

An open-source, self-hosted **MCP knowledge base for trusted internal teams**, backed by **Amazon Bedrock Knowledge Bases** (S3 + S3 Vectors). The control plane runs on **Better Auth + Postgres**; AWS owns content storage, retrieval, and background jobs.

Spin up **as many brains as you want** from the web admin UI. Each brain is fully isolated — its own S3 bucket, Bedrock KB, vector index, connectors, suggestions queue, and bearer token. One MCP service serves all of them; clients reach a brain at `/brain/<brain_id>/mcp`.

> ⚠️ **Alpha.** Useful today for self-hosted, trusted-team deployments — not hardened multi-tenant SaaS. Read [ALPHA.md](./ALPHA.md), [SECURITY.md](./SECURITY.md), and [CONTRIBUTING.md](./CONTRIBUTING.md) before deploying with sensitive data.

## Architecture

```
 Claude · Cursor · Claude Code · …
        │  /brain/<id>/mcp  + per-brain bearer token
        ▼
 ┌──────────────────┐     ┌──────────────────────┐
 │ App Runner       │────▶│ Postgres control     │  orgs, brains, connectors,
 │ FastMCP (Python) │     │ plane (Better Auth)  │  suggestions, MCP token hashes
 └────────┬─────────┘     └──────────────────────┘
          │  brain resolved from URL path
   ┌──────┴───────┬──────────────────┐
   ▼              ▼                  ▼
 Bedrock KB   S3 docs bucket    Lambda auto-ingest
 + S3 Vectors (markdown, ver.)  on every S3 PutObject
 (per brain)  (per brain)       → StartIngestionJob
```

Brain create/delete runs at runtime via `BrainProvisionerFn`, which provisions per-brain AWS resources (`context101-brain-*`) and writes the brain row to Postgres. The control plane (orgs, brains, connectors, suggestions, hashed MCP tokens) lives entirely in Postgres.

## Features

- **Per-brain isolation** — create/switch/delete brains from the web UI; ~$0 idle each (pay-per-query KB + S3 Vectors).
- **4 MCP tools** — `search_knowledge`, `read_knowledge`, `list_sources`, `suggest_knowledge` (see [Tools](#mcp-tools)).
- **Two-tier retrieval** — search returns synthesized, deduplicated **wiki** chunks; raw sources are an escape hatch via `read_knowledge`.
- **Auto-generated wiki** — a Fargate task synthesizes a cross-referenced DeepWiki-style wiki + per-repo **code wikis** from each brain's corpus.
- **KB chat playground** — `/wiki/ask` runs retrieval-grounded Q&A against the active brain.
- **Data connectors** — Google Sheets/Docs/Slides, Notion (recursive page tree), and GitHub (code + docs) sync into markdown every 6h.
- **Configurable embeddings** — pick a brain's embedding model (AWS Titan or Cohere via Bedrock); changing it re-embeds in place with zero client re-pointing.
- **Improve with AI** — Opus-assisted rewrites of any doc with a side-by-side diff before save.
- **Suggestions queue** — agents propose docs via `suggest_knowledge`; nothing is written until a human approves.

## Repo Layout

```
cdk/                  TypeScript CDK — all AWS infra (provisioner, auto-ingest,
                      start-wiki-gen, connector-dispatch + per-provider sync Lambdas)
server.py             Python MCP server (FastMCP + Postgres brain routing)
web/                  Next.js admin app (Amplify Hosting) — brains, files, wiki, sources
site/                 Standalone public marketing site
packages/{design,ui}  Shared design system across site/ and web/ (npm workspaces)
wiki-generator/       Fargate wiki task (Python)
wiki-generator-ts/    TypeScript port — adds subscription-backed LLM providers
knowledge/            Optional bootstrap seed for the default brain
```

`web/` is what self-hosters deploy; `site/` is the standalone project site.

## Prerequisites

- **AWS CLI v2** authenticated for the target account, **Node 20+**, **Docker** (CDK asset bundling), and **Python 3.11+** (only for running the MCP server / wiki generator locally).
- **Region `us-east-1`** is the smooth path (S3 Vectors + the Opus cross-region inference profile have region caveats).
- **CDK bootstrap:** `npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1`
- **Bedrock model access** (console → *Model access*): an embedding model (e.g. `amazon.titan-embed-text-v2:0`) and `us.anthropic.claude-opus-4-7` for *Improve with AI* + wiki gen.
- **GitHub token** with `repo` scope for Amplify to watch your fork (`gh auth token`).
- **Postgres** — Neon (`DATABASE_DRIVER=neon-http`) or Supabase/RDS/Aurora/local (`postgres-js`; set `DATABASE_PREPARE=false` for Supabase pooler URLs).
- **(Optional) OAuth client secrets** for Google/Notion connectors.

## Setup

> 🛡️ **Always deploy via `./cdk/deploy.sh`** — it refuses to run without both gating tokens (`CTX_TOKEN`, `CTX_GH_TOKEN`), preventing a bare `cdk deploy` from deleting the App Runner + Amplify resources (this has bitten the team once).
>
> ```bash
> cp cdk/.deploy-env.example cdk/.deploy-env   # or ~/.context101/deploy-env
> $EDITOR cdk/.deploy-env                       # paste tokens + Postgres/Better Auth vars
> chmod 600 cdk/.deploy-env
> ```
> The GitHub PAT is auto-discovered from `gh auth token` if you're logged in.

**1. Deploy.** From `cdk/`: `npm install && ./deploy.sh`. Pass `--seed` *only on first deploy* to upload the `knowledge/` examples (off by default so later deploys never clobber S3). Apply the control-plane schema with `npm run db:migrate` from `web/`. With both tokens set, the same `./deploy.sh` brings up the MCP service **and** the web app — note `McpUrl` and `WebAppDefaultDomain` in the outputs.

> ⚠️ If CDK added new Amplify env vars this deploy, kick one more build so they're picked up:
> `aws amplify start-job --app-id <WebAppId> --branch-name main --job-type RELEASE`

**2. Set required env vars** in `.deploy-env` before deploying: `DATABASE_URL`, `DATABASE_DRIVER`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `MCP_TOKEN_PEPPER` (raw MCP tokens are hashed into Postgres, never stored), `APP_URL`, plus `SES_REGION` / `SES_FROM_EMAIL` for transactional emails (invites, etc.).

**3. Create the first admin.** Self-hosted: visit `/setup` to create the first Better Auth user + org, then invite teammates via the org-member flow. Keep `ALLOW_PUBLIC_SIGNUP=false`.

**4. (Optional) Connectors.** Store OAuth client creds in Secrets Manager (CDK references them by name, so rotating doesn't need a redeploy):

```bash
aws secretsmanager create-secret --name context101-google-oauth-client \
  --secret-string '{"client_id":"…","client_secret":"…"}' --region us-east-1
aws secretsmanager create-secret --name context101-notion-oauth-client \
  --secret-string '{"client_id":"…","client_secret":"…"}' --region us-east-1
```

Redirect URI for both: `https://<WebAppDefaultDomain>/api/connectors/oauth/callback`. Google needs *read-only* Sheets/Docs/Slides/Drive scopes; Notion must be a **public** integration with **Read content** only. GitHub uses a pasted PAT (fine-grained, **Contents: Read-only**) — avoid `gho_…` CLI tokens, which rotate and break syncs.

## Connect an MCP client

Each brain has its own URL + bearer token, both copy-pasteable from the web app's **About** page (or the brain's row on `/brains`).

```jsonc
// Cursor (.cursor/mcp.json) — Claude Desktop is the same via `npx -y mcp-remote <url> --header "Authorization: Bearer <token>"`
{ "mcpServers": { "context101": {
  "url": "https://<McpHost>/brain/<brain_id>/mcp",
  "headers": { "Authorization": "Bearer <per-brain-token>" }
} } }
```

Use a distinct `mcpServers` key per brain to run several side by side. **Run locally** with `uvicorn server:app --port 8787 --host 0.0.0.0` (set `DATABASE_URL` + `MCP_TOKEN_PEPPER`); hit `http://localhost:8787/brain/default/mcp`.

## MCP Tools

All tools are scoped to the brain in the URL path.

| Tool | Purpose |
|------|---------|
| `search_knowledge(query, limit=5)` | Semantic search over the brain's **canonical wiki** — ranked chunks from synthesized pages (never raw docs) |
| `read_knowledge(s3_key)` | Full content of any doc (raw or wiki) — the escape hatch to ground truth |
| `list_sources()` | Enumerate every document in the brain's docs bucket |
| `suggest_knowledge(title, content, …)` | Propose a doc/update → the brain's review queue; never writes directly |

**Why two tiers:** raw sources (`knowledge/`, `sources/…`) and synthesized `wiki/` pages both live in the index, but `search_knowledge` filters to `source=wiki` via a `.metadata.json` sidecar. This avoids near-duplicate retrieval, reconciles conflicting sources into one page, and keeps every chunk traceable back to its raw files via citations.

## Daily Workflow

Pick a brain in the header switcher; Files, Wiki, Suggestions, and Sources are all scoped to it. Content flows in three ways — **none require a deploy**:

1. **Web UI** — create/edit/move markdown, **Improve with AI**, approve suggestions.
2. **`suggest_knowledge`** — agents propose; humans approve in the Suggestions tab.
3. **Connectors** — auto-pull from Google/Notion/GitHub every 6h.

Every S3 write triggers the auto-ingest Lambda → Bedrock ingestion; new content is searchable within ~1 min. `cdk deploy` is reserved for **infra changes** and the initial seed only.

## Connectors

Connect a Google Sheet/Doc/Slides deck, Notion page/database, or GitHub repo from the **Sources** tab. A connector belongs to the **active brain** and writes under `sources/<type>/<slug>/…`; it re-syncs every 6h (EventBridge → `connector-dispatch` → per-type Lambda). Each connection's credential lives in its own Secrets Manager secret.

| Type | Output |
|------|--------|
| Sheets | one markdown table per tab |
| Docs / Slides | headings, lists, tables, speaker notes → markdown |
| Notion | recursive block tree → markdown; databases unfold one file per row |
| GitHub | code + docs only; markdown passthrough, code fenced (ext allowlist, path denylist, 200KB cap) |

Every file gets a `source=<type>` sidecar for tracing. Remove a connector → its secret, S3 objects, and Postgres row are deleted and Bedrock re-indexes within a minute.

## Wiki & Code Wikis

A **Fargate task** (`wiki-generator/`) synthesizes a cross-referenced wiki under `wiki/` from each brain's corpus — rendered read-only in the **Wiki** tab with Mermaid diagrams and source citations. Connected GitHub repos also get a dedicated **code wiki** per repo (`wiki/code/<repo>/`, `source=code-wiki`); the team wiki *references* code wikis rather than re-ingesting raw code.

- **Manual-only by default** — regen runs only on **Refresh now** (`WikiGenSchedule` ships `enabled: false`; code-wiki auto-fire gated behind `AUTO_TRIGGER_CODE_WIKI`). Keeps Opus spend predictable.
- **No-change guard** — each run hashes the corpus (S3 ETags, no body downloads) into `wiki/_meta.json`; an unchanged corpus exits without calling Opus.
- **Single-flight** — `start-wiki-gen` checks ECS for a running task before `RunTask`, so concurrent clicks attach to the same regen.
- **Two LLM calls** — one cheap structure pass (filenames + previews → page plan), one deep per-page pass (full `relevant_files`).
- **TypeScript port** (`wiki-generator-ts/`) adds **subscription-backed** generation: `MODEL_PROVIDER=claude-code` (Claude Pro/Max via the Agent SDK) or `codex` (ChatGPT Plus/Pro) run in-container, so the marginal cost is just compute. Mind each provider's ToS.

Cost: ~$0.30–0.80 per full regen; Fargate runtime ~3–5 min.

**Run locally:** `cd wiki-generator && pip install -r requirements.txt && DOCS_BUCKET=<DocsBucketName> AWS_REGION=us-east-1 python generate.py`. Useful env knobs: `WIKI_PREFIX` (set `wiki-preview/` to iterate on prompts), `MIN_PAGES`/`MAX_PAGES`, `WIKI_FORCE=1` (bypass the hash guard).

## Costs (per brain)

| Resource | Idle |
|---|---|
| S3 docs bucket | $0 (storage only) |
| Bedrock KB + S3 Vectors | $0 (pay-per-query) |
| Suggestions + connectors (Postgres) | ~$0 at alpha scale |
| Bearer-token secret | ~$0.40/mo |
| App Runner MCP | **shared** across all brains, ~$5–15/mo total |

So a hundred brains cost about the same as one, plus ~$0.40/mo each in secrets.

## Cleanup

- **One brain:** delete its row on `/brains` (type the name to confirm). The provisioner empties + deletes the bucket, KB, vector index, and token secret; connectors/suggestions/tokens cascade-delete. The default brain can't be deleted this way.
- **Whole stack:** `cd cdk && ./deploy.sh destroy`. The default docs bucket and shared vector bucket are `RETAIN` — empty them manually if you want them gone. **Runtime-created brains aren't in CloudFormation** — delete them from `/brains` first or sweep `context101-brain-*` resources manually.

## Why this stack

**S3 Vectors** (cheapest store, stays in S3) · **Bedrock embeddings** (Titan or Cohere, no third-party keys) · **App Runner** (one stable TLS URL, doesn't scale with brain count) · **per-brain bearer tokens** (one compromise doesn't touch others) · **Postgres + Better Auth** control plane.

## Roadmap

Per-brain RBAC · per-user MCP auth · sub-brain metadata filters · GitHub App/OAuth flow (vs. PAT) · Slack/Discord chat connector · per-page code-wiki caching · deep links to wiki pages · hierarchical/semantic chunking · multimodal ingestion · App Runner → ECS Express Mode migration (App Runner closed to new customers, no EOL yet).

---

Badges generated with [shieldcn](https://github.com/jal-co/shieldcn). Licensed under [MIT](./LICENSE).
