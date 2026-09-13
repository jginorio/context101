# context101-cli

your context. every agent.

Thin self-host CLI for [Context101](https://github.com/jginorio/context101) — a wrapper around Amazon Bedrock Knowledge Bases. Self-host now; hosted later (not there yet). Alpha / trusted-team.

This is the AWS front door: init, deploy, list, destroy, config. Not a wiki app.

**`npx context101` (unscoped) is Context7's MCP — not this tool.** Use `context101-cli`.

## Install

```bash
npm i -g context101-cli
context101 <cmd>
```

or

```bash
npx context101-cli@latest <cmd>
```

## Commands

| Command | What it does |
| --- | --- |
| `context101 init` | write deploy-env; TTY asks to deploy |
| `context101 deploy` | deploy the AWS stack |
| `context101 list` | list Context101 CloudFormation stacks |
| `context101 destroy <name>` | tear down a listed stack |
| `context101 config` | show deploy-env keys (values redacted) |
| `context101 config set KEY=value` | write one key (chmod 600; value is not printed) |
| `context101 help` | list commands |
| `context101 version` | print the installed CLI version (`-v`, `--version`) |

`list`, `help`, and `destroy --dry-run` work without a checkout.

```bash
context101 list
context101 help
context101 destroy Context101Stack --dry-run
```

## Name collision

The publishable package is **context101-cli**. The bin name is `context101`.

`npx context101` downloads Context7's MCP from npm. Unrelated.

## Repo

https://github.com/jginorio/context101
