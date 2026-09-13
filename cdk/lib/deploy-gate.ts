/**
 * Fail-closed gate for Context101 CDK commands.
 *
 * MCP (`-c token=`) is an optional construct. A bare `cdk deploy` /
 * `synth` without that flag synthesizes MCP away and CloudFormation
 * deletes the live service. That already happened once.
 *
 * Amplify admin always ships (CodeCommit in the stack). githubToken is
 * required only when REPOSITORY is set (optional GitHub override).
 *
 * The CLI (`context101 deploy`) is the front door — it loads
 * cdk/.deploy-env and passes the context flags. This module throws
 * before the `if (token)` block can emit an empty MCP update.
 *
 * `cdk destroy` of the whole stack is allowed (CLI `destroy <name>`).
 */

export const GATE_COMMANDS_REQUIRE_TOKEN = new Set([
  "deploy",
  "synth",
  "diff",
]);

export function cdkCommandFromArgv(argv: string[] = process.argv): string {
  const known = new Set([
    "deploy",
    "synth",
    "diff",
    "destroy",
    "ls",
    "list",
    "bootstrap",
    "import",
    "watch",
  ]);
  for (const arg of argv) {
    if (known.has(arg)) return arg;
  }
  // `cdk` with no subcommand synths.
  return "synth";
}

export function assertGatedContext(opts: {
  command?: string;
  token?: string | undefined;
  githubToken?: string | undefined;
  repository?: string | undefined;
} = {}): void {
  const command = opts.command || "synth";
  if (command === "destroy") return;
  if (!GATE_COMMANDS_REQUIRE_TOKEN.has(command)) return;

  const token = String(opts.token ?? "").trim();
  const githubToken = String(opts.githubToken ?? "").trim();
  const repository = String(opts.repository ?? "").trim();

  if (!token) {
    throw new Error(
      "Missing CTX_TOKEN. MCP is gated on `-c token=` — a deploy without it deletes the service. Run `context101 deploy` or `context101 init`."
    );
  }
  if (repository && !githubToken) {
    throw new Error(
      "Missing GitHub PAT (githubToken). Amplify is gated on this flag — a deploy without it deletes Hosting. Run `context101 deploy` or `context101 init`."
    );
  }
}
