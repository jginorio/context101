import { existsSync } from "node:fs";
import path from "node:path";
import {
  ALLOW_PUBLIC_SIGNUP,
  APP_MODE,
  BILLING_ENABLED,
  DRIVER_POSTGRES,
  EXAMPLE_ENV_REL,
  SMOOTH_REGION,
} from "./defaults.js";
import { defaultAmplifyRepository } from "./amplify-repo.js";
import {
  classifyGithubToken,
  githubTokenWorksForAmplify,
  printChecks,
  runChecks,
} from "./checks.js";
import { requestEmbeddingModelAccess } from "./bedrock-access.js";
import {
  isKnownEmbeddingModel,
  listEmbeddingModels,
} from "./embedding-models.js";
import { formatExistingEnvSummary } from "./config.js";
import { readDeployEnvFile } from "./deploy-env-load.js";
import {
  inferDriver,
  inferPrepare,
  readExampleToken,
  writeDeployEnv,
} from "./env-file.js";
import { ensureCheckoutDeps } from "./checkout-deps.js";
import { startDeploy } from "./deploy.js";
import { createExec } from "./exec.js";
import { formatDryRun, nextSteps } from "./plan.js";
import { findRepoRoot, normalizeRepoUrl } from "./repo.js";
import { generateCtxToken, generateSecret } from "./secrets.js";
import {
  DEFAULT_SPACE,
  defaultSpaceEnvPath,
  displaySpaceEnv,
  findSpaceByTarget,
  loadSpace,
  namePrefixForSpace,
  parseSpaceName,
  registerSpaceEnv,
  stackNameForSpace,
} from "./spaces.js";
import { ensureStackRoot, resolveStackRoot, resolveStackSource } from "./stack-source.js";
import { writers } from "./style.js";
import { listAwsProfiles, resolveAwsAuth } from "./aws-profiles.js";
import { homedir } from "node:os";

export async function runInit(opts, ctx) {
  const io = writers(ctx);
  const exec = ctx.exec ?? createExec(ctx.env);

  if (opts.dryRun) {
    io.dim("dry-run — no files, no secrets written, no deploy");
    io.write("");
  }

  const homeDir = ctx.homeDir ?? homedir();
  const env = ctx.env ?? {};
  const tty = Boolean(ctx.stdin && ctx.stdin.isTTY && ctx.stdout && ctx.stdout.isTTY);
  const repoRoot = findRepoRoot(ctx.cwd) || ctx.cwd;
  const stackSource =
    resolveStackSource({
      stackRoot: ctx.stackRoot,
      env,
      homeDir,
      cwd: ctx.cwd,
      version: ctx.cliVersion,
      packageDir: ctx.packageDir,
    }) || ctx.stackRoot;

  let spaceName;
  try {
    spaceName = await resolveInitSpaceName(opts, ctx, { tty, io });
  } catch (error) {
    if (error && error.code === "USAGE") {
      io.err(error.message);
      return 1;
    }
    throw error;
  }

  const existingSpace = findSpaceByTarget(spaceName, { homeDir, cwd: ctx.cwd });
  const envPath = opts.envFile
    ? path.isAbsolute(opts.envFile)
      ? opts.envFile
      : path.resolve(ctx.cwd ?? ".", opts.envFile)
    : opts.home
      ? path.join(homeDir, ".context101", "deploy-env")
      : existingSpace?.envPath || defaultSpaceEnvPath(spaceName, homeDir);
  const envDisplay = displaySpaceEnv(envPath, homeDir);
  const envExists = existsSync(envPath);

  let seedFromEnv = null;
  let reuseSecrets = null;
  let rewriteExisting = false;

  if (envExists && !opts.force && !opts.dryRun) {
    const resume = await resumeExistingInit({
      opts,
      ctx,
      io,
      exec,
      env,
      tty,
      repoRoot,
      envPath,
      envDisplay,
    });
    if (resume.done) return resume.code;
    seedFromEnv = resume.seed;
    reuseSecrets = resume.secrets;
    rewriteExisting = true;
  }

  const region = opts.region ?? SMOOTH_REGION;
  const profiles = listAwsProfiles({ exec, env });
  const resolved = resolveAwsAuth({
    explicitProfile: opts.awsProfile || env.AWS_PROFILE || null,
    accessKeyId:
      opts.awsAccessKeyId || env.AWS_ACCESS_KEY_ID || seedFromEnv?.awsAccessKeyId || null,
    secretAccessKey:
      opts.awsSecretAccessKey ||
      env.AWS_SECRET_ACCESS_KEY ||
      seedFromEnv?.awsSecretAccessKey ||
      null,
    profiles,
    yes: opts.yes,
    dryRun: opts.dryRun,
  });
  let awsProfile = resolved.profile;
  let awsAccessKeyId = resolved.accessKeyId;
  let awsSecretAccessKey = resolved.secretAccessKey;
  if (resolved.source === "ask-profile" && !opts.dryRun) {
    if (resolved.error && (opts.yes || !tty)) {
      io.err(resolved.error);
      return 1;
    }
    if (!tty) {
      io.err(
        `multiple AWS profiles (${profiles.join(", ")}). Pass --aws-profile or run in a TTY.`
      );
      return 1;
    }
    awsProfile = await (ctx.chooseProfile ?? chooseAwsProfile)(profiles, {
      current: opts.awsProfile || env.AWS_PROFILE || seedFromEnv?.awsProfile || null,
    });
  }
  if (resolved.source === "ask-keys" && !opts.dryRun) {
    if (resolved.error && (opts.yes || !tty)) {
      io.err(resolved.error);
      return 1;
    }
    if (!tty) {
      io.err(
        "no AWS profiles. Pass --aws-access-key-id and --aws-secret-access-key, or configure a profile."
      );
      return 1;
    }
    const keys = await (ctx.promptAwsKeys ?? promptAwsKeys)();
    awsAccessKeyId = keys.accessKeyId;
    awsSecretAccessKey = keys.secretAccessKey;
  }
  const awsEnv = withAwsAuth(env, {
    profile: awsProfile,
    accessKeyId: awsAccessKeyId,
    secretAccessKey: awsSecretAccessKey,
  });
  const checks = runChecks({
    exec,
    env: awsEnv,
    region,
    dryRun: opts.dryRun,
  });
  printChecks(
    {
      ...checks,
      awsProfile,
      awsProfiles: profiles,
      hasAwsKeys: Boolean(awsAccessKeyId && awsSecretAccessKey),
      awsAuthSource: resolved.source,
    },
    io
  );
  if (checks.docker?.hint && !checks.docker.daemon) {
    io.write(checks.docker.hint);
  }
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
      awsEnv,
      tty,
      awsProfile,
      awsAccessKeyId,
      awsSecretAccessKey,
      seedFromEnv,
      promptAnswers: ctx.promptAnswers,
    });
  } catch (error) {
    if (error && error.code === "USAGE") {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
  if (answers === null) return 1;

  const plan = {
    region: answers.region,
    account: checks.aws.identity?.account ?? "",
    awsProfile,
    awsProfiles: profiles,
    hasAwsKeys: Boolean(awsAccessKeyId && awsSecretAccessKey),
    bootstrapped: checks.bootstrap.ok,
    repository: answers.repository,
    embedModelId: answers.embedModelId || "",
    embeddingModels: answers.embeddingModels || [],
    requestBedrockAccess: Boolean(answers.requestBedrockAccess),
    hasDatabaseUrl: Boolean(answers.databaseUrl),
    createRds: Boolean(answers.createRds),
    databaseDriver: answers.databaseDriver,
    databasePrepare: answers.databasePrepare,
    envDisplay,
    envExists,
    seed: answers.seed,
    deploy: answers.deploy,
    dockerInstalled: Boolean(checks.docker?.installed),
    dockerDaemon: Boolean(checks.docker?.daemon),
  };

  if (opts.dryRun) {
    io.write(formatDryRun(plan));
    io.write("");
    return 0;
  }

  if (envExists && !opts.force && !rewriteExisting) {
    io.err(`${envDisplay} already exists. Re-run with --force to overwrite.`);
    return 1;
  }

  const secrets = {
    CTX_TOKEN: reuseSecrets?.CTX_TOKEN || generateCtxToken(),
    BETTER_AUTH_SECRET: reuseSecrets?.BETTER_AUTH_SECRET || generateSecret(),
    MCP_TOKEN_PEPPER: reuseSecrets?.MCP_TOKEN_PEPPER || generateSecret(),
    ...(answers.createRds ? {} : { DATABASE_URL: answers.databaseUrl }),
  };
  if (answers.ghToken) secrets.CTX_GH_TOKEN = answers.ghToken;
  else if (reuseSecrets?.CTX_GH_TOKEN) secrets.CTX_GH_TOKEN = reuseSecrets.CTX_GH_TOKEN;

  const exampleToken = await readExampleToken(
    path.join(stackSource || repoRoot, ...EXAMPLE_ENV_REL.split("/"))
  );
  if (exampleToken && secrets.CTX_TOKEN === exampleToken) {
    io.err("refusing to write the example CTX_TOKEN — generated a collision; re-run.");
    return 1;
  }

  const values = {
    ...secrets,
    AWS_PROFILE: answers.awsProfile,
    AWS_ACCESS_KEY_ID: answers.awsAccessKeyId,
    AWS_SECRET_ACCESS_KEY: answers.awsSecretAccessKey,
    AWS_REGION: answers.region,
    DATABASE_DRIVER: answers.databaseDriver,
    DATABASE_PREPARE: answers.databasePrepare,
    CREATE_RDS: answers.createRds ? "true" : "",
    APP_MODE,
    ALLOW_PUBLIC_SIGNUP,
    BILLING_ENABLED,
    REPOSITORY: answers.repository || "",
    EMBED_MODEL_ID: answers.embedModelId || "",
    SPACE: spaceName,
    STACK_NAME: existingSpace?.values.STACK_NAME || stackNameForSpace(spaceName),
    NAME_PREFIX: existingSpace?.values.NAME_PREFIX || namePrefixForSpace(spaceName),
  };

  await writeDeployEnv(envPath, values);
  registerSpaceEnv(spaceName, envPath, { homeDir });

  io.ok(`wrote ${envDisplay} (chmod 600)`);
  if (answers.requestBedrockAccess) {
    printBedrockAccess(
      requestEmbeddingModelAccess({
        exec,
        env: awsEnv,
        region: answers.region,
        models: answers.embeddingModels,
      }),
      io
    );
  }
  if (answers.repository && !githubReadyForAmplify(checks, answers)) {
    io.warn(
      "no Amplify-capable GitHub PAT yet — set CTX_GH_TOKEN to a ghp_ or github_pat_ token before deploy"
    );
  }

  return finishAfterEnv({
    opts,
    ctx,
    io,
    exec,
    tty,
    checks,
    awsEnv,
    repoRoot,
    createRds: Boolean(answers.createRds),
    seed: answers.seed,
    repository: answers.repository || "",
    ghToken: answers.ghToken,
    home: answers.home ?? opts.home,
    envFile: answers.envFile ?? opts.envFile ?? envPath,
    deployFlag: Boolean(answers.deploy),
    spaceName,
    stackRoot: resolveStackRoot({
      stackRoot: ctx.stackRoot,
      env,
      homeDir,
      cwd: ctx.cwd,
      version: ctx.cliVersion,
      packageDir: ctx.packageDir,
    }),
  });
}

async function resumeExistingInit({
  opts,
  ctx,
  io,
  exec,
  env,
  tty,
  repoRoot,
  envPath,
  envDisplay,
}) {
  if (!tty || opts.yes) {
    io.err(
      `${envDisplay} already exists. Re-run with --force to overwrite (new secrets).`
    );
    return { done: true, code: 1 };
  }

  const loaded = readDeployEnvFile(envPath);
  const values = loaded.values;
  io.write(`${envDisplay} already exists.`);
  io.write("");
  for (const line of formatExistingEnvSummary(values).split("\n")) {
    io.dim(line);
  }
  io.write("");

  const keep = await askResumeExisting(ctx);
  if (!keep) {
    return {
      done: false,
      seed: seedFromExistingEnv(values),
      secrets: pickExistingSecrets(values),
    };
  }

  const region = opts.region || values.AWS_REGION || SMOOTH_REGION;
  const awsProfile = opts.awsProfile || values.AWS_PROFILE || env.AWS_PROFILE || null;
  const awsAccessKeyId =
    opts.awsAccessKeyId || values.AWS_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID || null;
  const awsSecretAccessKey =
    opts.awsSecretAccessKey ||
    values.AWS_SECRET_ACCESS_KEY ||
    env.AWS_SECRET_ACCESS_KEY ||
    null;
  const awsEnv = withAwsAuth(env, {
    profile: awsProfile,
    accessKeyId: awsAccessKeyId,
    secretAccessKey: awsSecretAccessKey,
  });
  const checks = runChecks({
    exec,
    env: awsEnv,
    region,
    dryRun: false,
  });
  printChecks(
    {
      ...checks,
      awsProfile,
      hasAwsKeys: Boolean(awsAccessKeyId && awsSecretAccessKey),
    },
    io
  );
  if (checks.docker?.hint && !checks.docker.daemon) {
    io.write(checks.docker.hint);
  }
  if (checks.bootstrap.ok === false && checks.aws.identity?.account) {
    io.warn(
      `CDK bootstrap needed: npx cdk bootstrap aws://${checks.aws.identity.account}/${region}`
    );
  }
  io.write("");

  const createRds = String(values.CREATE_RDS || "").toLowerCase() === "true";
  const code = await finishAfterEnv({
    opts,
    ctx,
    io,
    exec,
    tty,
    checks,
    awsEnv,
    repoRoot,
    createRds,
    seed: opts.seed,
    repository: values.REPOSITORY || "",
    ghToken: values.CTX_GH_TOKEN || null,
    home: opts.home,
    envFile: opts.envFile || envPath,
    deployFlag: Boolean(opts.deploy),
    spaceName: parseSpaceName(opts.space || DEFAULT_SPACE, { required: false }) || DEFAULT_SPACE,
    stackRoot: resolveStackRoot({
      stackRoot: ctx.stackRoot,
      env,
      homeDir: ctx.homeDir,
      cwd: ctx.cwd,
      version: ctx.cliVersion,
      packageDir: ctx.packageDir,
    }),
  });
  return { done: true, code };
}

function seedFromExistingEnv(values = {}) {
  return {
    awsProfile: values.AWS_PROFILE || null,
    awsAccessKeyId: values.AWS_ACCESS_KEY_ID || null,
    awsSecretAccessKey: values.AWS_SECRET_ACCESS_KEY || null,
    region: values.AWS_REGION || null,
    repository: values.REPOSITORY || "",
    databaseUrl: values.DATABASE_URL || "",
    createRds: String(values.CREATE_RDS || "").toLowerCase() === "true",
  };
}

function pickExistingSecrets(values = {}) {
  const secrets = {};
  for (const key of ["CTX_TOKEN", "BETTER_AUTH_SECRET", "MCP_TOKEN_PEPPER", "CTX_GH_TOKEN"]) {
    if (values[key]) secrets[key] = values[key];
  }
  return secrets;
}

async function finishAfterEnv({
  opts,
  ctx,
  io,
  exec,
  tty,
  checks,
  awsEnv,
  repoRoot,
  createRds,
  seed,
  repository,
  ghToken,
  home,
  envFile,
  deployFlag,
  spaceName,
  stackRoot,
}) {
  const homeDir = ctx.homeDir ?? homedir();
  const readyStack = await ensureStackRoot({
    stackRoot: stackRoot || ctx.stackRoot,
    env: awsEnv,
    homeDir,
    cwd: ctx.cwd,
    fetchStack: ctx.fetchStack,
    version: ctx.cliVersion,
    packageDir: ctx.packageDir,
    io,
  });
  if (!readyStack.ok && deployFlag) {
    io.err(readyStack.error);
    return 1;
  }
  const sourceRoot = readyStack.stackRoot || repoRoot;
  if (sourceRoot) {
    const ready = ensureCheckoutDeps({
      repoRoot: sourceRoot,
      exec: exec ?? ctx.exec,
      io,
      packageDir: ctx.packageDir,
    });
    if (!ready.ok && (deployFlag || existsSync(path.join(sourceRoot, "package-lock.json")))) {
      io.err(ready.error);
      return 1;
    }
  }

  let deploy = Boolean(deployFlag);
  if (!deploy && !opts.yes && tty) {
    deploy = Boolean(
      await askDeployNow(ctx, {
        createRds: Boolean(createRds),
        seed: Boolean(seed),
        repository: repository || "",
      })
    );
  }

  if (!deploy) {
    io.write(nextSteps({ seed }));
    return 0;
  }

  if (repository && !githubReadyForAmplify(checks, { ghToken })) {
    io.err(
      "not deploying: Amplify needs a GitHub PAT (ghp_ / github_pat_). Installation and gh OAuth tokens cannot create repo webhooks and will roll the stack back."
    );
    return 1;
  }

  return startDeploy({
    io,
    ctx,
    repoRoot: sourceRoot,
    stackRoot: sourceRoot,
    space: spaceName
      ? loadSpace(spaceName, { homeDir: ctx.homeDir ?? homedir() })
      : undefined,
    seed,
    env: awsEnv,
    home,
    envFile,
    exec: exec ?? ctx.exec,
    verbose: opts.verbose,
    dockerDaemon: Boolean(checks.docker?.daemon),
    dockerHint: checks.docker?.hint,
  });
}

async function resolveInitSpaceName(opts, ctx, { tty, io }) {
  if (opts.space) return parseSpaceName(opts.space);
  if (opts.yes || opts.dryRun) return DEFAULT_SPACE;
  if (!tty) return DEFAULT_SPACE;
  if (typeof ctx.promptSpace === "function") {
    return parseSpaceName(await ctx.promptSpace(DEFAULT_SPACE));
  }
  const { input } = await import("@inquirer/prompts");
  const name = await input({
    message: "Space name",
    default: DEFAULT_SPACE,
    validate: (value) => {
      try {
        parseSpaceName(value);
        return true;
      } catch (error) {
        return error.message;
      }
    },
  });
  io.write("");
  return parseSpaceName(name);
}

async function collectAnswers(opts, ctx) {
  const { repoRoot, exec, io, env, awsEnv, tty } = ctx;
  const seeded = ctx.seedFromEnv;
  const repository = opts.repo
    ? normalizeRepoUrl(opts.repo)
    : seeded
      ? seeded.repository || ""
      : defaultAmplifyRepository();
  const databaseUrl = opts.databaseUrl || env.DATABASE_URL || seeded?.databaseUrl || "";
  const awsProfile = ctx.awsProfile ?? null;
  const awsAccessKeyId = ctx.awsAccessKeyId ?? null;
  const awsSecretAccessKey = ctx.awsSecretAccessKey ?? null;
  if (opts.embedModel && !isKnownEmbeddingModel(opts.embedModel)) {
    const error = new Error(
      `--embed-model must be a Bedrock Titan or Cohere embedding id (got ${opts.embedModel})`
    );
    error.code = "USAGE";
    throw error;
  }
  const catalog = listEmbeddingModels({
    exec,
    env: awsEnv,
    region: SMOOTH_REGION,
  });

  if (opts.dryRun || opts.yes) {
    const createRds = !databaseUrl;
    return {
      region: SMOOTH_REGION,
      repository,
      embedModelId: opts.embedModel || "",
      embeddingModels: catalog.models,
      requestBedrockAccess: !opts.skipBedrockAccess,
      databaseUrl: createRds ? "" : databaseUrl,
      createRds,
      databaseDriver:
        opts.databaseDriver ||
        (createRds ? DRIVER_POSTGRES : inferDriver(databaseUrl)),
      databasePrepare:
        opts.databasePrepare == null
          ? createRds
            ? true
            : inferPrepare(databaseUrl)
          : opts.databasePrepare,
      awsProfile,
      awsAccessKeyId,
      awsSecretAccessKey,
      home: opts.home,
      envFile: opts.envFile,
      seed: opts.seed,
      deploy: Boolean(opts.deploy && opts.yes && !opts.dryRun),
      ghToken: null,
    };
  }

  if (!tty) {
    io.err("not a TTY. Re-run with --yes or --dry-run.");
    return null;
  }

  const prompt = ctx.promptAnswers ?? (await import("./prompt.js")).promptAnswers;
  const prompted = await prompt({
    defaults: {
      repoRoot,
      region: seeded?.region || SMOOTH_REGION,
      repository,
      embedModelId: opts.embedModel || "",
      databaseUrl,
      createRds: Boolean(seeded?.createRds),
      awsProfile,
      awsAccessKeyId,
      awsSecretAccessKey,
    },
    io,
    exec,
    env: awsEnv,
  });
  return {
    ...prompted,
    embeddingModels: catalog.models,
    requestBedrockAccess: !opts.skipBedrockAccess,
    createRds: prompted.createRds ?? !prompted.databaseUrl,
    home: opts.home,
    envFile: opts.envFile,
    seed: opts.seed,
    deploy: Boolean(opts.deploy && !opts.dryRun),
    ghToken: null,
  };
}

function withAwsAuth(env, { profile, accessKeyId, secretAccessKey } = {}) {
  const next = { ...env };
  if (profile) next.AWS_PROFILE = profile;
  if (accessKeyId) next.AWS_ACCESS_KEY_ID = accessKeyId;
  if (secretAccessKey) next.AWS_SECRET_ACCESS_KEY = secretAccessKey;
  return next;
}

async function askResumeExisting(ctx) {
  if (typeof ctx.confirmResume === "function") {
    return ctx.confirmResume();
  }
  const { promptExistingEnvContinue } = await import("./prompt.js");
  return promptExistingEnvContinue();
}

async function askDeployNow(ctx, details) {
  if (typeof ctx.confirmDeploy === "function") {
    return ctx.confirmDeploy(details);
  }
  const { promptDeployNow } = await import("./prompt.js");
  return promptDeployNow(details);
}

function printBedrockAccess(results, io) {
  const problems = (results || []).filter(
    (result) => result.status === "needs-console" || result.status === "failed"
  );
  const granted = (results || []).filter((result) => result.status === "granted").length;
  if (problems.length) {
    const ids = problems
      .slice(0, 2)
      .map((result) => result.id)
      .join(", ");
    const extra = problems.length > 2 ? ` (+${problems.length - 2})` : "";
    io.warn(`Bedrock: enable ${ids}${extra} in console → Model access`);
  } else if (granted) {
    io.ok("Bedrock access granted");
  }
}

function githubReadyForAmplify(checks, answers) {
  if (answers.ghToken) {
    return githubTokenWorksForAmplify(classifyGithubToken(answers.ghToken));
  }
  return Boolean(checks.gh.amplifyOk);
}

async function chooseAwsProfile(profiles, { current } = {}) {
  const { select } = await import("@inquirer/prompts");
  const fallback = current && profiles.includes(current) ? current : profiles[0];
  return select({
    message: "AWS profile to deploy to",
    default: fallback,
    choices: profiles.map((name) => ({ name, value: name })),
  });
}

async function promptAwsKeys() {
  const { input, password } = await import("@inquirer/prompts");
  const accessKeyId = await input({
    message: "AWS access key ID",
    validate: (value) => (value ? true : "needed to deploy"),
  });
  const secretAccessKey = await password({
    message: "AWS secret access key",
    mask: true,
    validate: (value) => (value ? true : "needed to deploy"),
  });
  return { accessKeyId, secretAccessKey };
}
