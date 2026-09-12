# Context101

your context. every agent.

A thin self-hostable wrapper around Amazon Bedrock Knowledge Bases (S3 + S3 Vectors, FastMCP per-brain, Better Auth + Postgres control plane, Next admin in `web/`, marketing in `site/`). Self-host now, paid hosting later (not shipped). Alpha, trusted-team only ([ALPHA.md](./ALPHA.md)). This is not a wiki app. Retrieval is raw-first, and wiki generation is paused / optional beta.

## Front door

The CLI is the only user-facing door. Package `context101-cli`, bin `context101`. Unscoped `npx context101` is Context7's MCP, unrelated.

```bash
npx context101-cli@latest init
context101 deploy
context101 list
context101 destroy <name>
context101 help
```

`list`, `help`, and `destroy --dry-run` need no checkout. CDK fails closed without `CTX_TOKEN` (plus `CTX_GH_TOKEN` when Amplify watches a repo). `cdk/deploy.sh` is a shim. Never run bare `cdk deploy`. Never print deploy-env, `CTX_TOKEN`, or MCP bearers.

Install and the rest of the commands are in [packages/cli/README.md](./packages/cli/README.md).

## What you get

- Next admin in `web/`
- Per-brain Bedrock Knowledge Base, S3 docs bucket, and FastMCP at `/brain/<id>/mcp`
- Marketing site in `site/`
- Postgres control plane (Better Auth, brains, connectors, suggestions)

```
cdk/                  AWS CDK
packages/cli/         context101-cli, bin context101
web/                  Next admin
site/                 marketing
wiki-generator-ts/    wiki Fargate image (optional beta)
server.py             FastMCP
```

## Alpha

Trusted-team only. There is no per-brain RBAC. `BILLING_ENABLED` stays false. This is not public multi-tenant SaaS. Caveats, intended use, and AWS notes are in [ALPHA.md](./ALPHA.md).

## Wiki

Wiki generation is paused, optional beta. Leave the EventBridge `WikiGenSchedule` disabled. Do not set `AUTO_TRIGGER_CODE_WIKI`. Retrieval does not wait on a wiki. Operator docs live in [wiki-generator-ts/README.md](./wiki-generator-ts/README.md).

## More

- [ALPHA.md](./ALPHA.md)
- [packages/cli/README.md](./packages/cli/README.md)
- [wiki-generator-ts/README.md](./wiki-generator-ts/README.md)
- [WIKI_PYTHON_REMOVED.md](./WIKI_PYTHON_REMOVED.md)
- [SECURITY.md](./SECURITY.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
