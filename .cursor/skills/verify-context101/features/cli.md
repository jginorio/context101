# CLI

The self-host CLI (`packages/cli`, npm `context101-cli`, bin `context101`) is the AWS front door for Context101 stack ops. Face command is **list**. A default verify run drives only `help`, `help list`, `help urls`, `list`, and `destroy <name> --dry-run`. Do not run `init --force`, `deploy`, or a real destroy. `urls` against a live space is optional when AWS creds can describe the stack.

## Sub-features

- `cli-doctor` resolves `context101` on PATH, or `npx -y context101-cli@0.1.2`. `context101 help` exits 0.
- `cli-help` runs `context101 help` (command list + Context7 name-collision note), `context101 help list` (list topic help), and `context101 help urls` (urls topic help).
- `cli-list` runs `context101 list [--aws-profile <name>]` with no checkout. Expect a Context101 spaces table (`SPACE` / `STACK` / `STATUS` when local spaces exist, or `NAME` / `STATUS` / `UPDATED` from CloudFormation).
- `cli-urls` (optional) runs `context101 urls <space> [--aws-profile <name>]`. Expect `admin` plus `mcp` (or `mcp (legacy)`). Amplify-skipped spaces print `admin  skipped` — do not invent an admin URL. Never print `CTX_TOKEN` or a bearer hint. Skip if `list` has no space or describe-stacks fails.
- `cli-destroy-dry-run` runs `context101 destroy <space-or-stack> --dry-run [--aws-profile <name>]`. Must print `dry-run — destroy nothing` and `Would destroy <name>`. Must not destroy.
- `cli-init-deploy` exists (`init`, `deploy`, `diff`, `synth`, real `destroy`). Out of a default run — document only.

## How to get to it (user POV)

- Install or invoke the publishable package: `npx -y context101-cli@0.1.2` (bin name `context101`).
- From this checkout, drive via `.cursor/skills/verify-context101/bin/cli` when present, or a `context101` already on PATH.
- `list`, `urls`, `help`, and `destroy --dry-run` need no product clone. `init` / `deploy` / `diff` / `synth` / destroy-for-real use the CLI-owned stack source (this CLI version), not a git pull.

## Driving it with bin/cli

Preconditions:

- A fresh short-lived shell session per command (this is not the long-lived `:3000` admin).
- `which context101` or `npx -y context101-cli@0.1.2`; `context101 help` exits 0.
- AWS creds or `--aws-profile <name>` when `list` / `urls` / `destroy --dry-run` must talk to CloudFormation. `plateapr.com` is a live-stack example, not a hard requirement. Those commands also need the `aws` CLI on PATH (`cloudformation list-stacks` / `describe-stacks`); `help` does not.
- Do not start `:3000`. Do not run `init --force`, `deploy`, or destroy without `--dry-run`.

- **Doctor.** `command -v context101` or fall back to `npx -y context101-cli@0.1.2`. `.cursor/skills/verify-context101/bin/cli help` exits 0.
- **Help.** `.cursor/skills/verify-context101/bin/cli help` lists `init` / `deploy` / `diff` / `synth` / `list` / `urls` / `destroy` / `config` / `help` and notes that unscoped `npx context101` is Context7's MCP. `.cursor/skills/verify-context101/bin/cli help list` prints list topic help (`list — list Context101 spaces (no checkout)`). `.cursor/skills/verify-context101/bin/cli help urls` prints urls topic help (`urls [space] — print public admin and MCP URLs`). Redirect stdout to `artifacts/cli/help.txt`, `artifacts/cli/help-list.txt`, and `artifacts/cli/help-urls.txt`.
- **List.** `.cursor/skills/verify-context101/bin/cli list --aws-profile <name>` (omit `--aws-profile` when the default AWS env is already the right account). Exit 0. Table header includes `NAME` and `STATUS`. A live Platea stack example is `Context101Stack` `UPDATE_COMPLETE`. Redirect stdout to `artifacts/cli/list.txt`.
- **Urls (optional).** `.cursor/skills/verify-context101/bin/cli urls <space> --aws-profile <name>` using a name from `list`. Exit 0. Stdout includes `admin` and `mcp` (CloudFront `McpLambdaUrl` preferred; App Runner is `mcp (legacy)`). If Amplify was skipped, `admin  skipped`. Do not invent a URL. Redirect stdout to `artifacts/cli/urls.txt`.
- **Destroy dry-run.** `.cursor/skills/verify-context101/bin/cli destroy <StackName> --dry-run --aws-profile <name>` using a name from `list`. Exit 0. Stdout includes `dry-run — destroy nothing` and `Would destroy <StackName>`. A follow-up `list` still shows the same `STATUS` (nothing destroyed). Redirect stdout to `artifacts/cli/destroy-dry-run.txt`.
- **Init / deploy (skip).** `init`, `deploy`, `diff`, `synth`, and destroy without `--dry-run` are gated. Do not run them in a default verify pass.

## Gotchas

- Package name is `context101-cli`. Unscoped `npx context101` downloads Context7's MCP — unrelated.
- Fresh short-lived shell session per command. The CLI is not the long-lived admin on `:3000`.
- `list` / `urls` / `help` / `destroy --dry-run` need no product clone. Named spaces live in `~/.context101/spaces/<name>/`. Update the CLI, then `context101 deploy [space]` — not a git pull.
- Never print deploy-env secrets or AWS keys. `config` redacts values; still skip it unless asked.
- `--aws-profile plateapr.com` is a Platea live-stack example, not a required profile name.
- `list`, `urls`, and `destroy --dry-run` shell out to the `aws` CLI (`cloudformation list-stacks` / `describe-stacks`). If `command -v aws` fails, install it; `help` still works without it.
- Proof goes under `.cursor/skills/verify-context101/artifacts/cli/` (gitignored). `bin/cli` is a forwarder — redirect stdout yourself.
