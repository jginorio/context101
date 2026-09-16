# context101-cli

your context. every agent.

Thin self-host CLI for [Context101](https://github.com/jginorio/context101) — a wrapper around Amazon Bedrock Knowledge Bases. Self-host now; hosted later (not there yet). Alpha / trusted-team.

This is the AWS front door: init, update, list, urls, destroy, config, connectors setup. Not a wiki app.

**`npx context101` (unscoped) is Context7's MCP — not this tool.** Use `context101-cli`.

## Install

Pin the version. `@latest` is a no-op on some machines.

```bash
npm i -g context101-cli@0.1.24
context101 <cmd>
```

or

```bash
npx -y context101-cli@0.1.24 <cmd>
```

## Commands

| Command | What it does |
| --- | --- |
| `context101 init [space]` | name a space and write its deploy-env; nameless `init` prompts, then TTY asks to deploy |
| `context101 update [space]` | update that space from this CLI version |
| `context101 deploy [space]` | same as update |
| `context101 list` | list spaces |
| `context101 urls [space]` | print public admin and MCP URLs (`url`) |
| `context101 destroy [space]` | tear down a space |
| `context101 config` | show deploy-env keys (values redacted) |
| `context101 config set KEY=value` | write one key (chmod 600; value is not printed) |
| `context101 connectors setup <google\|notion\|github>` | write instance OAuth/app secrets to Secrets Manager (values not printed) |
| `context101 help` | list commands |
| `context101 version` | print the installed CLI version (`-v`, `--version`) |

`list`, `urls`, `help`, `version`, and `destroy --dry-run` work without a product clone. New deploys always create Amplify (`admin  https://main.…`). Stacks that have not been updated yet still print `admin  skipped` — there is no invented admin URL.

Deploy is quiet on a TTY (`deploying…`). `--verbose` dumps cdk / npm / docker. `-v` is version, not verbose.

Spaces live in `~/.context101/spaces/<name>/`. Each has its own AWS profile, region, secrets, and CloudFormation stack name. `context101 init acme` uses the space name you choose (`acme` is an example); nameless `init` prompts. An existing `cdk/.deploy-env` or `~/.context101/deploy-env` is the `default` space.

The next day: pin the new CLI (`context101` offers a pin-install, or `npm i -g context101-cli@0.1.24`), then `context101 update` / `context101 update platea`. The stack source is this CLI version — packaged stack copied to `~/.cache/context101/<version>/`, CDK `--output` beside it — not a git pull of your clone. Admin is Amplify SSR from a CodeCommit repo in the stack (no GitHub PAT). `--dry-run` is preview only.

```bash
context101 list
context101 urls platea
context101 help
context101 destroy platea --dry-run
context101 update platea
context101 connectors setup google --dry-run
```

Google / Notion / GitHub App instance clients go in Secrets Manager. `connectors setup` writes the secret (never prints the value) and the SM **name** into deploy-env (`GOOGLE_OAUTH_CLIENT_SECRET_ID` / `NOTION_OAUTH_CLIENT_SECRET_ID` / `GITHUB_APP_SECRET_ID`). Then `context101 update` and Connect in admin. PAT for a single GitHub repo is still pasted in the admin, not here.

## Name collision

The publishable package is **context101-cli**. The bin name is `context101`.

`npx context101` downloads Context7's MCP from npm. Unrelated.

## Repo

https://github.com/jginorio/context101
