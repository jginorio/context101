import { homedir } from "node:os";
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
import { LABEL_DEPLOYING, createProgress } from "./progress.js";
import { resolveSelectedSpace } from "./spaces.js";
import { ensureStackRoot } from "./stack-source.js";
import { writers } from "./style.js";

export async function runDeploy(opts, ctx) {
  return runCdkCommand(opts, ctx, opts.command || "deploy");
}

async function runCdkCommand(opts, ctx, action) {
  const io = writers(ctx);
  const exec = ctx.exec ?? createExec(ctx.env);
  const homeDir = ctx.homeDir ?? homedir();

  if (opts.dryRun) {
    io.dim(`dry-run — ${action} nothing`);
    io.write("");
  }

  let space;
  try {
    space = await resolveSelectedSpace(opts, { ...ctx, homeDir });
  } catch (error) {
    if (error && error.code === "USAGE") {
      io.err(error.message);
      return 1;
    }
    throw error;
  }

  const envFile = opts.envFile || space.envPath;
  const readyStack = await ensureStackRoot({
    stackRoot: ctx.stackRoot,
    env: ctx.env ?? {},
    homeDir,
    cwd: ctx.cwd,
    fetchStack: ctx.fetchStack,
    io: opts.verbose ? io : undefined,
  });
  if (!readyStack.ok) {
    io.err(readyStack.error);
    return 1;
  }
  const stackRoot = readyStack.stackRoot;

  const env = withSpaceAws(ctx.env ?? {}, space);
  const checks = runChecks({
    exec,
    env,
    region: space.region || SMOOTH_REGION,
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
      repoRoot: stackRoot,
      env,
      home: opts.home,
      envFile,
      cwd: ctx.cwd,
      exec,
    });
    assertDeployTokens(context, { action });
    args = buildCdkArgs({
      action,
      seed: opts.seed,
      context,
      env,
      stackName: space.stackName,
      namePrefix: space.namePrefix,
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
      stackRoot,
      space,
      seed: opts.seed,
      env,
      envFile,
      exec,
      verbose: opts.verbose,
      dockerDaemon: Boolean(checks.docker?.daemon),
      dockerHint: checks.docker?.hint,
    });
  }

  const progress = createProgress({
    stdout: ctx.stdout,
    env: ctx.env,
    verbose: opts.verbose,
  });
  return (ctx.runDeploy ?? runCdk)({
    repoRoot: stackRoot,
    stackRoot,
    action,
    seed: opts.seed,
    env,
    envFile,
    cwd: ctx.cwd,
    exec,
    io,
    verbose: opts.verbose,
    progress,
    stackName: space.stackName,
    namePrefix: space.namePrefix,
  });
}

export async function startDeploy({
  io,
  ctx,
  repoRoot,
  stackRoot,
  space,
  seed,
  env,
  home,
  envFile,
  exec,
  verbose = false,
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

  const sourceRoot = stackRoot || repoRoot;
  const progress = createProgress({
    stdout: ctx.stdout,
    env: ctx.env,
    verbose,
  });
  if (verbose) io.write("Deploying the stack…");
  else if (!ctx.stdout?.isTTY) io.write(LABEL_DEPLOYING);
  else progress.start(LABEL_DEPLOYING);
  return (ctx.runDeploy ?? runCdk)({
    repoRoot: sourceRoot,
    stackRoot: sourceRoot,
    action: "deploy",
    seed,
    env,
    home,
    envFile,
    cwd: ctx.cwd,
    exec: exec ?? ctx.exec,
    io,
    verbose,
    progress,
    stackName: space?.stackName,
    namePrefix: space?.namePrefix,
  });
}

function withSpaceAws(env, space) {
  const next = { ...env };
  if (space?.awsProfile && !next.AWS_PROFILE) next.AWS_PROFILE = space.awsProfile;
  if (space?.values?.AWS_ACCESS_KEY_ID && !next.AWS_ACCESS_KEY_ID) {
    next.AWS_ACCESS_KEY_ID = space.values.AWS_ACCESS_KEY_ID;
  }
  if (space?.values?.AWS_SECRET_ACCESS_KEY && !next.AWS_SECRET_ACCESS_KEY) {
    next.AWS_SECRET_ACCESS_KEY = space.values.AWS_SECRET_ACCESS_KEY;
  }
  return next;
}
