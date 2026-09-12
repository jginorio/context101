import { DEPLOY_CLI, DESTROY_CLI, SMOOTH_REGION, STACK_NAME } from "./defaults.js";
import { createExec, runDeployWrapper } from "./exec.js";
import { findRepoRoot } from "./repo.js";
import { banner, writers } from "./style.js";

export function parseStackSummaries(payload) {
  const rows = payload?.StackSummaries;
  return Array.isArray(rows) ? rows : [];
}

export function isContext101Deployment(stack) {
  if (!stack || stack.ParentId) return false;
  if (String(stack.StackStatus || "") === "DELETE_COMPLETE") return false;
  const name = String(stack.StackName || "");
  const desc = String(stack.TemplateDescription || "");
  return /context101/i.test(name) || /context101/i.test(desc);
}

export function listDeployments({ exec, env, region = SMOOTH_REGION } = {}) {
  if (!exec) {
    return { ok: false, stacks: [], error: "aws cli not available" };
  }
  const result = exec({
    command: "aws",
    args: ["cloudformation", "list-stacks", "--region", region, "--output", "json"],
    env,
  });
  if (!result.ok) {
    return {
      ok: false,
      stacks: [],
      error: result.stderr || result.stdout || "aws cloudformation list-stacks failed",
    };
  }
  try {
    const stacks = parseStackSummaries(JSON.parse(result.stdout || "{}")).filter(
      isContext101Deployment
    );
    stacks.sort((a, b) => String(a.StackName).localeCompare(String(b.StackName)));
    return { ok: true, stacks, error: null };
  } catch {
    return { ok: false, stacks: [], error: "could not parse cloudformation list-stacks" };
  }
}

export function formatDeployments(stacks, { region = SMOOTH_REGION } = {}) {
  if (!stacks.length) {
    return [`No Context101 deployments in ${region}.`, `Next: ${DEPLOY_CLI}`].join("\n");
  }
  const nameW = Math.max(4, ...stacks.map((s) => String(s.StackName).length));
  const statusW = Math.max(6, ...stacks.map((s) => String(s.StackStatus).length));
  const lines = [
    `Context101 deployments in ${region}`,
    "",
    `${"NAME".padEnd(nameW)}  ${"STATUS".padEnd(statusW)}  UPDATED`,
  ];
  for (const stack of stacks) {
    const updated = stack.LastUpdatedTime || stack.CreationTime || "";
    lines.push(
      `${String(stack.StackName).padEnd(nameW)}  ${String(stack.StackStatus).padEnd(statusW)}  ${updated}`
    );
  }
  return lines.join("\n");
}

export async function runList(opts, ctx) {
  const io = writers(ctx);
  const exec = ctx.exec ?? createExec(ctx.env);

  banner(ctx);

  const repoRoot = findRepoRoot(ctx.cwd);
  if (!repoRoot) {
    io.err("run this from a Context101 checkout (needs cdk/ and web/).");
    return 1;
  }

  const env = withAwsAuth(ctx.env ?? {}, {
    profile: opts.awsProfile,
    accessKeyId: opts.awsAccessKeyId,
    secretAccessKey: opts.awsSecretAccessKey,
  });
  const listed = listDeployments({ exec, env, region: SMOOTH_REGION });
  if (!listed.ok) {
    io.err(listed.error);
    return 1;
  }
  io.write(formatDeployments(listed.stacks, { region: SMOOTH_REGION }));
  io.write("");
  return 0;
}

export async function runDestroy(opts, ctx) {
  const io = writers(ctx);
  const exec = ctx.exec ?? createExec(ctx.env);

  banner(ctx);
  if (opts.dryRun) {
    io.dim("dry-run — destroy nothing");
    io.write("");
  }

  const repoRoot = findRepoRoot(ctx.cwd);
  if (!repoRoot) {
    io.err("run this from a Context101 checkout (needs cdk/ and web/).");
    return 1;
  }

  const env = withAwsAuth(ctx.env ?? {}, {
    profile: opts.awsProfile,
    accessKeyId: opts.awsAccessKeyId,
    secretAccessKey: opts.awsSecretAccessKey,
  });
  const listed = listDeployments({ exec, env, region: SMOOTH_REGION });
  if (!listed.ok) {
    io.err(listed.error);
    return 1;
  }

  io.write(formatDeployments(listed.stacks, { region: SMOOTH_REGION }));
  io.write("");

  if (listed.stacks.length === 0) {
    return 0;
  }

  if (opts.dryRun) {
    io.write(`Would destroy ${STACK_NAME}`);
    io.write(`Next: ${DESTROY_CLI} --yes`);
    return 0;
  }

  const tty = Boolean(ctx.stdin && ctx.stdin.isTTY && ctx.stdout && ctx.stdout.isTTY);
  if (!opts.yes) {
    if (!tty) {
      io.err("not a TTY. Re-run with --yes to destroy.");
      return 1;
    }
    const confirm = ctx.confirmDestroy ?? confirmDestroyPrompt;
    const ok = await confirm();
    if (!ok) {
      io.write("Cancelled.");
      return 1;
    }
  }

  io.warn(
    "Non-default brains are not in CloudFormation — delete them from /brains first."
  );
  io.write(`Destroying ${STACK_NAME}…`);
  return (ctx.runDeploy ?? runDeployWrapper)({
    repoRoot,
    action: "destroy",
    extraArgs: ["--force"],
    env,
  });
}

async function confirmDestroyPrompt() {
  const { confirm } = await import("@inquirer/prompts");
  return confirm({
    message: `Destroy ${STACK_NAME}? This cannot be undone.`,
    default: false,
  });
}

function withAwsAuth(env, { profile, accessKeyId, secretAccessKey } = {}) {
  const next = { ...env };
  if (profile) next.AWS_PROFILE = profile;
  if (accessKeyId) next.AWS_ACCESS_KEY_ID = accessKeyId;
  if (secretAccessKey) next.AWS_SECRET_ACCESS_KEY = secretAccessKey;
  return next;
}
