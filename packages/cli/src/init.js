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
import { defaultAmplifyRepository, detectGithubLogin } from "./amplify-repo.js";
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
import {
  inferDriver,
  inferPrepare,
  readExampleToken,
  writeDeployEnv,
} from "./env-file.js";
import { startDeploy } from "./deploy.js";
import { createExec } from "./exec.js";
import { formatDryRun, nextSteps } from "./plan.js";
import { ensureRepoRoot } from "./clone.js";
import {
  detectGitRemote,
  displayEnvPath,
  findRepoRoot,
  normalizeRepoUrl,
  resolveEnvPath,
} from "./repo.js";
import { generateCtxToken, generateSecret } from "./secrets.js";
import { banner, writers } from "./style.js";
import { listAwsProfiles, resolveAwsAuth } from "./aws-profiles.js";

export async function runInit(opts, ctx) {
  const io = writers(ctx);
  const exec = ctx.exec ?? createExec(ctx.env);

  banner(ctx);
  if (opts.dryRun) {
    io.dim("dry-run — no files, no secrets written, no deploy");
    io.write("");
  }

  const checkout = ensureRepoRoot({
    cwd: ctx.cwd,
    dir: opts.dir,
    exec,
    io,
    dryRun: opts.dryRun,
  });
  if (checkout.error) {
    io.err(checkout.error);
    return 1;
  }
  const repoRoot = checkout.repoRoot;
  if (!repoRoot || (!opts.dryRun && !findRepoRoot(repoRoot))) {
    io.err("run this from a Context101 checkout (needs cdk/ and web/).");
    return 1;
  }
  if (checkout.wouldClone && opts.dryRun) {
    io.write("");
  }

  const region = opts.region ?? SMOOTH_REGION;
  const env = ctx.env ?? {};
  const tty = Boolean(ctx.stdin && ctx.stdin.isTTY && ctx.stdout && ctx.stdout.isTTY);
  const profiles = listAwsProfiles({ exec, env });
  const resolved = resolveAwsAuth({
    explicitProfile: opts.awsProfile || env.AWS_PROFILE || null,
    accessKeyId: opts.awsAccessKeyId || env.AWS_ACCESS_KEY_ID || null,
    secretAccessKey: opts.awsSecretAccessKey || env.AWS_SECRET_ACCESS_KEY || null,
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
      current: opts.awsProfile || env.AWS_PROFILE || null,
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

  if (envExists && !opts.force) {
    io.err(`${envDisplay} already exists. Re-run with --force to overwrite.`);
    return 1;
  }

  const secrets = {
    CTX_TOKEN: generateCtxToken(),
    BETTER_AUTH_SECRET: generateSecret(),
    MCP_TOKEN_PEPPER: generateSecret(),
    ...(answers.createRds ? {} : { DATABASE_URL: answers.databaseUrl }),
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
  };

  await writeDeployEnv(envPath, values);

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

  let deploy = Boolean(answers.deploy);
  if (!deploy && !opts.yes && tty) {
    deploy = Boolean(
      await askDeployNow(ctx, {
        createRds: Boolean(answers.createRds),
        seed: Boolean(answers.seed),
        repository: answers.repository || "",
      })
    );
  }

  if (!deploy) {
    io.write(nextSteps({ seed: answers.seed }));
    return 0;
  }

  if (answers.repository && !githubReadyForAmplify(checks, answers)) {
    io.err(
      "not deploying: Amplify needs a GitHub PAT (ghp_ / github_pat_). Installation and gh OAuth tokens cannot create repo webhooks and will roll the stack back."
    );
    return 1;
  }

  return startDeploy({
    io,
    ctx,
    repoRoot,
    seed: answers.seed,
    env: awsEnv,
    home: answers.home ?? opts.home,
    envFile: answers.envFile ?? opts.envFile,
    dockerDaemon: Boolean(checks.docker?.daemon),
    dockerHint: checks.docker?.hint,
  });
}

async function collectAnswers(opts, ctx) {
  const { repoRoot, exec, io, env, awsEnv, tty } = ctx;
  const remote = detectGitRemote(exec, repoRoot);
  const ghLogin = detectGithubLogin(exec);
  const repository = defaultAmplifyRepository({
    repo: opts.repo ? normalizeRepoUrl(opts.repo) : "",
    ghLogin,
  });
  const databaseUrl = opts.databaseUrl || env.DATABASE_URL || "";
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
      region: SMOOTH_REGION,
      repository,
      suggestedRepo: remote,
      embedModelId: opts.embedModel || "",
      databaseUrl,
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
