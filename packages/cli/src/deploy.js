import { SMOOTH_REGION } from "./defaults.js";
import { printChecks, runChecks } from "./checks.js";
import { createExec, runDeployWrapper } from "./exec.js";
import { deployCommand } from "./plan.js";
import { findRepoRoot } from "./repo.js";
import { banner, writers } from "./style.js";

export async function runDeploy(opts, ctx) {
  const io = writers(ctx);
  const exec = ctx.exec ?? createExec(ctx.env);

  banner(ctx);
  if (opts.dryRun) {
    io.dim("dry-run — deploy nothing");
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

  if (opts.dryRun) {
    io.write(`Would deploy: ${deployCommand(opts.seed)}`);
    return 0;
  }

  return startDeploy({
    io,
    ctx,
    repoRoot,
    seed: opts.seed,
    env,
    dockerDaemon: Boolean(checks.docker?.daemon),
    dockerHint: checks.docker?.hint,
  });
}

export async function startDeploy({
  io,
  ctx,
  repoRoot,
  seed,
  env,
  dockerDaemon,
  dockerHint,
}) {
  if (!dockerDaemon) {
    io.err(
      "not deploying: Docker daemon is not running. Start it, then run npx context101 deploy."
    );
    if (dockerHint) io.write(dockerHint);
    return 1;
  }

  io.write("Deploying the stack…");
  return (ctx.runDeploy ?? runDeployWrapper)({
    repoRoot,
    seed,
    env,
  });
}
