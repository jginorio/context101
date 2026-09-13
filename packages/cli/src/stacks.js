import { DEPLOY_CLI, DESTROY_CLI, LIST_CLI, SMOOTH_REGION } from "./defaults.js";
import { runCdk } from "./cdk-invoke.js";
import { ensureRepoRoot } from "./clone.js";
import { createExec } from "./exec.js";
import { writers } from "./style.js";

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

export function statusTone(status, colors = {}) {
  const s = String(status);
  if (/FAIL|ROLLBACK/i.test(s)) return colors.red ?? "";
  if (/IN_PROGRESS|PENDING|REVIEW/i.test(s)) return colors.violet ?? "";
  if (/COMPLETE/i.test(s)) return colors.magenta ?? "";
  return colors.violet ?? "";
}

export function formatDeployments(stacks, { region = SMOOTH_REGION, colors } = {}) {
  const c = colors ?? { magenta: "", violet: "", dim: "", red: "", bold: "", reset: "" };
  if (!stacks.length) {
    return [`No Context101 deployments in ${region}.`, `Next: ${DEPLOY_CLI}`].join("\n");
  }
  const nameW = Math.max(4, ...stacks.map((s) => String(s.StackName).length));
  const statusW = Math.max(6, ...stacks.map((s) => String(s.StackStatus).length));
  const lines = [
    `${c.dim}Context101 deployments in ${region}${c.reset}`,
    "",
    `${c.dim}${"NAME".padEnd(nameW)}  ${"STATUS".padEnd(statusW)}  UPDATED${c.reset}`,
  ];
  for (const stack of stacks) {
    const updated = stack.LastUpdatedTime || stack.CreationTime || "";
    const tone = statusTone(stack.StackStatus, c);
    lines.push(
      `${String(stack.StackName).padEnd(nameW)}  ${tone}${String(stack.StackStatus).padEnd(statusW)}${c.reset}  ${c.dim}${updated}${c.reset}`
    );
  }
  return lines.join("\n");
}

export async function runList(opts, ctx) {
  const io = writers(ctx);
  const exec = ctx.exec ?? createExec(ctx.env);

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
  io.write(formatDeployments(listed.stacks, { region: SMOOTH_REGION, colors: io.c }));
  io.write("");
  return 0;
}

export async function runDestroy(opts, ctx) {
  const io = writers(ctx);
  const exec = ctx.exec ?? createExec(ctx.env);

  if (opts.dryRun) {
    io.dim("dry-run — destroy nothing");
    io.write("");
  }

  const stackName = String(opts.stackName || "").trim();
  if (!stackName) {
    io.err(`destroy needs a stack name from \`${LIST_CLI}\`.`);
    io.write(`Next: ${LIST_CLI}`);
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

  io.write(formatDeployments(listed.stacks, { region: SMOOTH_REGION, colors: io.c }));
  io.write("");

  const known = listed.stacks.some((stack) => stack.StackName === stackName);
  if (!known) {
    io.err(`unknown stack ${stackName}. Use a name from \`${LIST_CLI}\`.`);
    return 1;
  }

  if (opts.dryRun) {
    io.write(`Would destroy ${stackName}`);
    io.write(`Next: ${DESTROY_CLI} ${stackName} --yes`);
    return 0;
  }

  const tty = Boolean(ctx.stdin && ctx.stdin.isTTY && ctx.stdout && ctx.stdout.isTTY);
  if (!opts.yes) {
    if (!tty) {
      io.err("not a TTY. Re-run with --yes to destroy.");
      return 1;
    }
    const confirm = ctx.confirmDestroy ?? confirmDestroyPrompt;
    const ok = await confirm(stackName);
    if (!ok) {
      io.write("Cancelled.");
      return 1;
    }
  }

  io.warn(
    "Non-default brains are not in CloudFormation — delete them from /brains first."
  );

  const checkout = ensureRepoRoot({
    cwd: ctx.cwd,
    dir: opts.dir,
    exec,
    io,
    preferHomeClone: true,
    homeDir: ctx.homeDir,
  });
  if (checkout.error) {
    io.err(checkout.error);
    return 1;
  }
  const repoRoot = checkout.repoRoot;
  if (!repoRoot) {
    io.err("could not find or clone a Context101 checkout (needs cdk/ and web/).");
    return 1;
  }

  io.write(`Destroying ${stackName}…`);
  return (ctx.runDeploy ?? runCdk)({
    repoRoot,
    action: "destroy",
    stackName,
    env,
    home: opts.home,
    envFile: opts.envFile,
    cwd: ctx.cwd,
    exec,
  });
}

async function confirmDestroyPrompt(stackName) {
  const { confirm } = await import("@inquirer/prompts");
  return confirm({
    message: `Destroy ${stackName}? This cannot be undone.`,
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
