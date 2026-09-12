import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ALLOW_PUBLIC_SIGNUP,
  APP_MODE,
  BILLING_ENABLED,
  DEFAULT_AMPLIFY_REPO,
  EXAMPLE_ENV_REL,
  SMOOTH_REGION,
} from "./defaults.js";
import { runChecks, printChecks } from "./checks.js";
import {
  inferDriver,
  inferPrepare,
  readExampleToken,
  writeDeployEnv,
} from "./env-file.js";
import { createExec, runDeployWrapper } from "./exec.js";
import { formatDryRun, nextSteps } from "./plan.js";
import { optionalNotes } from "./prompt.js";
import {
  detectGitRemote,
  displayEnvPath,
  findRepoRoot,
  readHardcodedRepo,
  resolveEnvPath,
} from "./repo.js";
import { generateCtxToken, generateSecret } from "./secrets.js";
import { banner, writers } from "./style.js";

export async function runInit(opts, ctx) {
  const io = writers(ctx);
  const exec = ctx.exec ?? createExec(ctx.env);

  banner(ctx);
  if (opts.dryRun) {
    io.dim("dry-run — no files, no secrets written, no deploy");
    io.write("");
  }

  const repoRoot = findRepoRoot(ctx.cwd);
  if (!repoRoot) {
    io.err("run this from a Context101 checkout (needs cdk/deploy.sh and web/).");
    return 1;
  }

  const region = opts.region ?? SMOOTH_REGION;
  const env = ctx.env ?? {};
  const awsEnv = withAwsProfile(env, opts.awsProfile ?? env.AWS_PROFILE);
  const checks = runChecks({ exec, env: awsEnv, region });
  printChecks(checks, io);
  if (checks.bootstrap.ok === false && checks.aws.identity?.account) {
    io.warn(
      `CDK bootstrap needed: npx cdk bootstrap aws://${checks.aws.identity.account}/${region}`
    );
  }
  io.write("");

  let answers;
  try {
    answers = await collectAnswers(opts, {
      repoRoot,
      checks,
      exec,
      io,
      env,
      tty: Boolean(ctx.stdin && ctx.stdin.isTTY && ctx.stdout && ctx.stdout.isTTY),
    });
  } catch (error) {
    if (error && error.code === "USAGE") {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
  if (answers === null) return 1;

  const envPath = resolveEnvPath(repoRoot, {
    envFile: answers.envFile ?? opts.envFile,
    home: answers.home ?? opts.home,
    cwd: ctx.cwd,
  });
  const envDisplay = displayEnvPath(envPath, repoRoot);
  const envExists = existsSync(envPath);

  const plan = {
    region: answers.region,
    account: checks.aws.identity?.account ?? "",
    bootstrapped: checks.bootstrap.ok,
    repository: answers.repository,
    hasDatabaseUrl: Boolean(answers.databaseUrl),
    databaseDriver: answers.databaseDriver,
    databasePrepare: answers.databasePrepare,
    envDisplay,
    envExists,
    seed: answers.seed,
    deploy: answers.deploy,
  };

  if (opts.dryRun) {
    io.write(formatDryRun(plan));
    if (answers.extras === "notes") io.write(`\n${optionalNotes()}`);
    io.write("");
    return 0;
  }

  if (envExists && !opts.force) {
    io.err(`${envDisplay} already exists. Re-run with --force to overwrite.`);
    return 1;
  }

  const secrets = {
    CTX_TOKEN: generateCtxToken(),
    BETTER_AUTH_SECRET: generateSecret(),
    MCP_TOKEN_PEPPER: generateSecret(),
    DATABASE_URL: answers.databaseUrl,
  };
  if (answers.ghToken) secrets.CTX_GH_TOKEN = answers.ghToken;

  const exampleToken = await readExampleToken(
    path.join(repoRoot, ...EXAMPLE_ENV_REL.split("/"))
  );
  if (exampleToken && secrets.CTX_TOKEN === exampleToken) {
    io.err("refusing to write the example CTX_TOKEN — generated a collision; re-run.");
    return 1;
  }

  const values = {
    ...secrets,
    AWS_PROFILE: answers.awsProfile,
    AWS_REGION: answers.region,
    DATABASE_DRIVER: answers.databaseDriver,
    DATABASE_PREPARE: answers.databasePrepare,
    APP_MODE,
    ALLOW_PUBLIC_SIGNUP,
    BILLING_ENABLED,
    REPOSITORY: answers.repository || DEFAULT_AMPLIFY_REPO,
  };

  await writeDeployEnv(envPath, values);

  io.ok(`wrote ${envDisplay} (chmod 600)`);
  if (!checks.gh.loggedIn && !answers.ghToken) {
    io.warn("no GitHub PAT yet — add CTX_GH_TOKEN or run `gh auth login` before deploy");
  }
  io.write("");
  io.write(nextSteps(plan));
  if (answers.extras === "notes") {
    io.write("");
    io.write(optionalNotes());
  }
  io.write("");

  if (!answers.deploy) return 0;

  if (!checks.gh.loggedIn && !answers.ghToken) {
    io.err("not deploying: CTX_GH_TOKEN / gh auth is missing. The wrapper would refuse.");
    return 1;
  }

  io.write("Running ./cdk/deploy.sh …");
  const code = await (ctx.runDeploy ?? runDeployWrapper)({
    repoRoot,
    seed: answers.seed,
    env: awsEnv,
  });
  return code;
}

async function collectAnswers(opts, ctx) {
  const { repoRoot, exec, io, env, tty } = ctx;
  const stackRepo = await readStackRepo(repoRoot);
  const remote = detectGitRemote(exec, repoRoot);
  const repository = opts.repo || remote || stackRepo || DEFAULT_AMPLIFY_REPO;
  const databaseUrl = opts.databaseUrl || env.DATABASE_URL || "";
  const awsProfile = opts.awsProfile || env.AWS_PROFILE || null;

  if (opts.dryRun || opts.yes) {
    if (opts.yes && !opts.dryRun && !databaseUrl) {
      io.err("--yes needs a Postgres URL. Pass --database-url or set DATABASE_URL.");
      return null;
    }
    return {
      region: SMOOTH_REGION,
      repository,
      databaseUrl,
      databaseDriver: opts.databaseDriver || inferDriver(databaseUrl),
      databasePrepare:
        opts.databasePrepare == null ? inferPrepare(databaseUrl) : opts.databasePrepare,
      awsProfile,
      home: opts.home,
      envFile: opts.envFile,
      seed: opts.seed,
      deploy: Boolean(opts.deploy && opts.yes && !opts.dryRun),
      extras: "skip",
      ghToken: null,
    };
  }

  if (!tty) {
    io.err("not a TTY. Re-run with --yes (and --database-url) or --dry-run.");
    return null;
  }

  const { promptAnswers } = await import("./prompt.js");
  return {
    ...(await promptAnswers({
      defaults: { repoRoot, region: SMOOTH_REGION, repository, awsProfile },
      io,
    })),
    ghToken: null,
  };
}

async function readStackRepo(repoRoot) {
  try {
    const source = await readFile(
      path.join(repoRoot, "cdk", "lib", "context101-stack.ts"),
      "utf8"
    );
    return readHardcodedRepo(source);
  } catch {
    return DEFAULT_AMPLIFY_REPO;
  }
}

function withAwsProfile(env, profile) {
  if (!profile) return { ...env };
  return { ...env, AWS_PROFILE: profile };
}
