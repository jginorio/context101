# context101-cli

your context. every agent.

Thin self-host CLI for [Context101](https://github.com/jginorio/context101) — a wrapper around Amazon Bedrock Knowledge Bases. Self-host now; hosted later (not there yet). Alpha / trusted-team.

This is the AWS front door: init, deploy, list, urls, destroy, config. Not a wiki app.

**`npx context101` (unscoped) is Context7's MCP — not this tool.** Use `context101-cli`.

## Install

Pin the version. `@latest` is a no-op on some machines.

```bash
npm i -g context101-cli@0.1.17
context101 <cmd>
```

or

```bash
npx -y context101-cli@0.1.17 <cmd>
```

## Commands

| Command | What it does |
| --- | --- |
| `context101 init [space]` | name a space and write its deploy-env; TTY asks to deploy |
| `context101 deploy [space]` | update that space from this CLI version |
| `context101 list` | list spaces |
| `context101 urls [space]` | print public admin and MCP URLs (`url`) |
| `context101 destroy [space]` | tear down a space |
| `context101 config` | show deploy-env keys (values redacted) |
| `context101 config set KEY=value` | write one key (chmod 600; value is not printed) |
| `context101 help` | list commands |
| `context101 version` | print the installed CLI version (`-v`, `--version`) |

`list`, `urls`, `help`, `version`, and `destroy --dry-run` work without a product clone. New deploys always create Amplify (`admin  https://main.…`). Stacks that have not been updated yet still print `admin  skipped` — there is no invented admin URL.

Deploy is quiet on a TTY (`deploying…`). `--verbose` dumps cdk / npm / docker. `-v` is version, not verbose.

Spaces live in `~/.context101/spaces/<name>/`. Each has its own AWS profile, region, secrets, and CloudFormation stack name. An existing `cdk/.deploy-env` or `~/.context101/deploy-env` is the `default` space.

The next day: update the CLI (`context101` offers a pin-install, or `npm i -g context101-cli@0.1.17`), then `context101 deploy` / `context101 deploy platea`. The stack source is this CLI version — packaged stack copied to `~/.cache/context101/<version>/`, CDK `--output` beside it — not a git pull of your clone. Admin is Amplify SSR from a CodeCommit repo in the stack (no GitHub PAT). `--dry-run` is preview only.

```bash
context101 list
context101 urls platea
context101 help
context101 destroy platea --dry-run
context101 deploy platea
```

## Name collision

The publishable package is **context101-cli**. The bin name is `context101`.

`npx context101` downloads Context7's MCP from npm. Unrelated.

## Repo

https://github.com/jginorio/context101
