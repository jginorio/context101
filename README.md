<p align="center">
  <img width="1280" alt="your context. every agent." src="docs/assets/readme-hero.png">
</p>

# Context101

## What it is

A thin self-hostable wrapper around Amazon Bedrock Knowledge Bases: S3 + S3 Vectors, FastMCP per brain, Better Auth + Postgres. You run it in your own AWS account.

The CLI is the front door. Deploying a space ships the admin UI with the stack.

## Install

```bash
npm i -g context101-cli@0.1.27
```

Pin the version — `@latest` is a no-op on some machines. The package is `context101-cli` (bin `context101`). Unscoped `npx context101` is Context7's MCP, unrelated.

Needs Node 20+, npm, AWS CLI v2, Docker, and an AWS account with Bedrock access.

## Quick start

`context101 init` prompts for a space name. That name is yours — not a license key or reserved token. Lowercase letters, numbers, and hyphens; start with a letter.

```bash
context101 init
```

Or pass a name:

```bash
context101 init my-team
```

That writes `~/.context101/spaces/<name>/` and, on a TTY, asks whether to deploy. After deploy, `context101 urls` prints the admin URL and MCP endpoints. First admin is created at `/setup`.

```bash
context101 list
context101 urls my-team
context101 update my-team
context101 destroy my-team --dry-run
context101 connectors setup google
```

`list`, `urls`, `help`, `version`, and `destroy --dry-run` work without a checkout. An existing `cdk/.deploy-env` is the `default` space.

The stack source is this CLI version (`~/.cache/context101/<version>/`). Later updates: pin the new CLI, then `context101 update [space]` — not `git pull`.

Deploy is a quiet `deploying…` spinner. `--verbose` dumps cdk / npm / docker. `-v` is version, not verbose. Never run bare `cdk deploy`. Never print deploy-env or MCP bearers.

## Brains

Each brain is a sealed knowledge base — its own S3 bucket, Bedrock KB, vector index, suggestions queue, and MCP token. Create brains in the admin. Each is served at `/brain/<id>/mcp`.

## Parked features

- Wiki generation — [WIKI_PARKED.md](./WIKI_PARKED.md)
- Conflicts detection — [ALPHA.md](./ALPHA.md)

## License

Copyright (c) 2026 Context101 contributors.

Context101 is licensed under the [Elastic License 2.0](./LICENSE). You can self-host it and use it privately or internally. Offering Context101 as a paid hosted or managed service to third parties is not allowed.

[SECURITY.md](./SECURITY.md) · [CONTRIBUTING.md](./CONTRIBUTING.md) · [CLI flags](./packages/cli/README.md)
