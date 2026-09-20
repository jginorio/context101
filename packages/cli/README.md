# context101-cli

Thin self-host CLI for [Context101](https://github.com/jginorio/context101) — a wrapper around Amazon Bedrock Knowledge Bases. You run it in your own AWS account. The bin is `context101`.

Unscoped `npx context101` is Context7's MCP — not this tool. Use `context101-cli`.

## Install

```bash
npm i -g context101-cli
```

That installs the `context101` command. Needs Node 20+, npm, AWS CLI v2, Docker, and an AWS account with Bedrock access.

Or run a command without a global install:

```bash
npx -y context101-cli <cmd>
```

## Quick start

`context101 init` prompts for a space name. Lowercase letters, numbers, and hyphens; start with a letter.

```bash
context101 init
```

Or pass a name:

```bash
context101 init my-team
```

That writes `~/.context101/spaces/<name>/`. In a terminal it asks whether to deploy. After deploy, open the admin URL from `context101 urls` and create the first admin.

```bash
context101 list
context101 urls my-team
context101 update my-team
context101 destroy my-team --dry-run
context101 connectors setup google
```

`list`, `urls`, `help`, `version`, and `destroy --dry-run` work without a checkout. An existing `cdk/.deploy-env` is the `default` space.

To update an existing space to the newest Context101, upgrade the CLI (`npm i -g context101-cli`), then run `context101 update <space>`.

Deploy is a quiet `deploying…` spinner. `--verbose` dumps cdk / npm / docker. `-v` is version, not verbose.

## Commands

| Command | What it does |
| --- | --- |
| `context101 init [space]` | name a space and write its deploy-env; nameless `init` prompts, then TTY asks to deploy |
| `context101 update [space]` | update that space from this CLI version |
| `context101 deploy [space]` | same as update |
| `context101 diff [space]` | cdk diff for a space |
| `context101 synth [space]` | cdk synth for a space |
| `context101 list` | list spaces (`ls`) |
| `context101 urls [space]` | print public admin and MCP URLs (`url`) |
| `context101 destroy [space]` | tear down a space |
| `context101 config` | show deploy-env keys (values redacted) |
| `context101 config set KEY=value` | write one key (chmod 600; value is not printed) |
| `context101 connectors` | TTY wizard to set up or update Google / Notion / GitHub App secrets |
| `context101 connectors setup <google\|notion\|github>` | write instance OAuth/app secrets to Secrets Manager (values not printed) |
| `context101 help` | list commands |
| `context101 version` | print the installed CLI version (`-v`, `--version`) |

Spaces live in `~/.context101/spaces/<name>/`. Each has its own AWS profile, region, secrets, and CloudFormation stack name.

Google / Notion / GitHub App instance clients go in Secrets Manager. `context101 connectors` on a TTY walks through provider status and setup. `connectors setup` is the script/CI path. Values are never printed. Then `context101 update` and Connect in admin. A GitHub PAT for a single repo is still pasted in the admin, not here.

## Brains

A space can have multiple isolated knowledge bases (brains). Each has its own MCP URL. Product detail is in the [Context101 README](https://github.com/jginorio/context101#brains).

## License

Copyright (c) 2026 Context101 contributors.

Context101 is licensed under the [Elastic License 2.0](https://github.com/jginorio/context101/blob/main/LICENSE). You can self-host it and use it privately or internally. Offering Context101 as a paid hosted or managed service to third parties is not allowed.

## Repo

https://github.com/jginorio/context101
