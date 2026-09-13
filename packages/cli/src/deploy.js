import { SMOOTH_REGION } from "./defaults.js";
import {
  assertDeployTokens,
  buildCdkArgs,
  formatCdkPreview,
  resolveDeployContext,
  runCdk,
} from "./cdk-invoke.js";
import { printChecks, runChecks } from "./checks.js";
import { createExec } from "./exec.js";
import { deployCommand } from "./plan.js";
import { findRepoRoot } from "./repo.js";
import { writers } from "./style.js";

export async function runDeploy(opts, ctx) {
  return runCdkCommand(opts, ctx, opts.command || "deploy");
}

async function runCdkCommand(opts, ctx, action) {
  const io = writers(ctx);
  const exec = ctx.exec ?? createExec(ctx.env);

  if (opts.dryRun) {
    io.dim(`dry-run — ${action} nothing`);
    io.write("");
  }

  const repoRoot = findRepoRoot(ctx.cwd);
  if (!repoRoot) {
    io.err("run this from a Context101 checkout (needs cdk/ and web/).");
    return 1;
  }

  const env = ctx.env ?? {};
  const checks = runChecks({
    exec,
    env,
    region: SMOOTH_REGION,
    dryRun: opts.dryRun,
  });
  printChecks(checks, io);
  if (checks.docker?.hint && !checks.docker.daemon) {
    io.write(checks.docker.hint);
  }
  io.write("");

  let context;
  let args;
  try {
    context = resolveDeployContext({
      repoRoot,
      env,
      home: opts.home,
      envFile: opts.envFile,
      cwd: ctx.cwd,
      exec,
    });
    assertDeployTokens(context, { action });
    args = buildCdkArgs({
      action,
      seed: opts.seed,
      context,
      env,
    });
  } catch (error) {
    if (error && error.code === "USAGE") {
      io.err(error.message);
      return 1;
    }
    throw error;
  }

  io.write(formatCdkPreview({ action, context, args, seed: opts.seed }));
  io.write("");

  if (opts.dryRun) {
    io.write(`Would invoke: ${deployCommand(opts.seed)}`);
    return 0;
  }

  if (action === "deploy") {
    return startDeploy({
      io,
      ctx,
      repoRoot,
      seed: opts.seed,
      env,
      home: opts.home,
      envFile: opts.envFile,
      dockerDaemon: Boolean(checks.docker?.daemon),
      dockerHint: checks.docker?.hint,
    });
  }

  return (ctx.runDeploy ?? runCdk)({
    repoRoot,
    action,
    seed: opts.seed,
    env,
    home: opts.home,
    envFile: opts.envFile,
    cwd: ctx.cwd,
    exec,
  });
}

export async function startDeploy({
  io,
  ctx,
  repoRoot,
  seed,
  env,
  home,
  envFile,
  dockerDaemon,
  dockerHint,
}) {
  if (!dockerDaemon) {
    io.err(
      "not deploying: Docker daemon is not running. Start it, then run context101 deploy."
    );
    if (dockerHint) io.write(dockerHint);
    return 1;
  }

  io.write("Deploying the stack…");
  return (ctx.runDeploy ?? runCdk)({
    repoRoot,
    action: "deploy",
    seed,
    env,
    home,
    envFile,
    cwd: ctx.cwd,
    exec: ctx.exec,
  });
}
