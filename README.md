# Context101

**your context. every agent.**

A thin self-hostable wrapper around Amazon Bedrock Knowledge Bases — S3 + S3 Vectors, FastMCP per-brain, Better Auth + Postgres. Self-host in your AWS. Paid hosting later is not shipped.

This repo is the self-host product: `packages/cli` (`context101-cli`), `cdk/`, and `web/` (the admin that ships inside the CLI). Marketing and later paid hosting are not here.

Alpha / trusted-team only. Not a wiki app. Retrieval is raw-first. Product focus is sources + retrieve. Wiki generation and Conflicts are parked ([WIKI_PARKED.md](./WIKI_PARKED.md)).

## context101

```bash
npm i -g context101-cli@0.1.26
```

Package `context101-cli`, bin `context101`. Pin the version — `@latest` is a no-op on some machines. Unscoped `npx context101` is Context7's MCP, unrelated.

```bash
context101 init acme
context101 update acme
context101 list
context101 urls acme
context101 destroy acme --dry-run
context101 connectors setup google
```

`acme` is the space name you choose, not a required token. Nameless `init` prompts. `init [space]` writes `~/.context101/spaces/<name>/`. `update` (`deploy`), `destroy`, `list`, and `urls` are space-aware. An existing `cdk/.deploy-env` is the `default` space.

Default deploy is a quiet `deploying…` spinner. `--verbose` dumps cdk / npm / docker. `-v` is version, not verbose. A successful deploy prints `✓ deployed <stack>` then the same public URL block as `urls`.

`list`, `urls`, `help`, `version`, and `destroy --dry-run` need no checkout.

The stack is this CLI version — packaged source copied to `~/.cache/context101/<version>/`, CDK `--output` beside it. Next time: pin the new CLI, then `context101 update [space]`. Not `git pull` on `~/context101`.

CDK fails closed without `CTX_TOKEN` (plus `CTX_GH_TOKEN` only if Amplify watches an external repo). Admin always ships on Amplify via a CodeCommit repo in the stack — no GitHub PAT. `cdk/deploy.sh` is a shim. Never run bare `cdk deploy`. Never print deploy-env or MCP bearers.

Commands and flags: [packages/cli/README.md](./packages/cli/README.md).

## Brains

Each brain is a sealed knowledge base — its own S3 bucket, Bedrock KB, vector index, suggestions queue, and MCP token — created in the admin (`web/`) and served at `/brain/<id>/mcp`.

Wiki generation is parked. Isolated restore: `cursor/wiki-isolated-de63`. Conflicts isolated restore: `cursor/conflicts-isolated-de63`. See [WIKI_PARKED.md](./WIKI_PARKED.md).

Trusted-team alpha. No per-brain RBAC. Not public multi-tenant SaaS. [ALPHA.md](./ALPHA.md)

[wiki-generator-ts/README.md](./wiki-generator-ts/README.md) · [SECURITY.md](./SECURITY.md) · [CONTRIBUTING.md](./CONTRIBUTING.md)
