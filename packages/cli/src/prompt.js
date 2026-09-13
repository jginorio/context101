import {
  DRIVER_NEON,
  DRIVER_POSTGRES,
  SMOOTH_REGION,
} from "./defaults.js";
import { inferDriver, inferPrepare } from "./env-file.js";
import { normalizeRepoUrl } from "./repo.js";

export function existingEnvContinueMessage() {
  return "Continue with these values?";
}

export function deployNowMessage({ createRds = false } = {}) {
  return createRds
    ? "Deploy the stack now? (CDK + Docker; creates RDS)"
    : "Deploy the stack now?";
}

export async function promptExistingEnvContinue() {
  const { confirm } = await import("@inquirer/prompts");
  return confirm({
    message: existingEnvContinueMessage(),
    default: true,
  });
}

export async function promptDeployNow(details = {}) {
  const { confirm } = await import("@inquirer/prompts");
  return confirm({
    message: deployNowMessage(details),
    default: false,
  });
}

export async function promptAnswers({ defaults, io, exec, env }) {
  const { confirm, input, password, select } = await import("@inquirer/prompts");

  io.write("This writes a local secrets file. Press ^C to quit.");
  io.write("");

  const region = await input({
    message: "AWS region",
    default: defaults.region ?? SMOOTH_REGION,
  });
  if (region !== SMOOTH_REGION) {
    io.warn(`${SMOOTH_REGION} is the smooth path (S3 Vectors + Bedrock).`);
  }

  const watchByDefault = Boolean(defaults.repository);
  const amplifyMode = await select({
    message: "Amplify frontend",
    default: watchByDefault ? "watch" : "skip",
    choices: [
      {
        name: "Skip — deploy the stack only (no GitHub-watched web app)",
        value: "skip",
      },
      { name: "Watch a GitHub repo", value: "watch" },
    ],
  });

  let repository = "";
  if (amplifyMode === "watch") {
    repository = normalizeRepoUrl(
      await input({
        message: "GitHub repo Amplify should watch",
        default: defaults.repository || defaults.suggestedRepo || "",
        validate: (value) =>
          value ? true : "needed if Amplify should watch a repo",
      })
    );
  }

  const dbMode = await select({
    message: "Postgres control plane",
    default: defaults.createRds ? "rds" : defaults.databaseUrl ? "url" : "rds",
    choices: [
      {
        name: "Create RDS — CDK provisions Postgres (db.t3.micro, public)",
        value: "rds",
      },
      {
        name: "I have a DATABASE_URL (Neon / Supabase / existing Postgres)",
        value: "url",
      },
    ],
  });

  let databaseUrl = "";
  let createRds = dbMode === "rds";
  let databaseDriver = DRIVER_POSTGRES;
  let databasePrepare = true;
  if (dbMode === "url") {
    databaseUrl = await password({
      message: "DATABASE_URL",
      mask: true,
      default: defaults.databaseUrl || undefined,
      validate: (value) =>
        value ? true : "needed unless CDK creates RDS",
    });
    createRds = false;
    const inferredDriver = inferDriver(databaseUrl);
    databaseDriver = await select({
      message: "DATABASE_DRIVER",
      default: inferredDriver,
      choices: [
        { name: `${DRIVER_NEON} (Neon)`, value: DRIVER_NEON },
        { name: `${DRIVER_POSTGRES} (Supabase / RDS / local)`, value: DRIVER_POSTGRES },
      ],
    });
    databasePrepare = await confirm({
      message: "DATABASE_PREPARE (false for Supabase transaction pooler)",
      default: inferPrepare(databaseUrl),
    });
  }

  return {
    region,
    repository,
    embedModelId: defaults.embedModelId || "",
    createRds,
    databaseUrl,
    databaseDriver,
    databasePrepare,
    awsProfile: defaults.awsProfile ?? null,
    awsAccessKeyId: defaults.awsAccessKeyId ?? null,
    awsSecretAccessKey: defaults.awsSecretAccessKey ?? null,
  };
}
