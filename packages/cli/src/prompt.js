import {
  DRIVER_NEON,
  DRIVER_POSTGRES,
  SMOOTH_REGION,
} from "./defaults.js";
import { inferDriver, inferPrepare } from "./env-file.js";
import { normalizeRepoUrl } from "./repo.js";
import { DEFAULT_SPACE, parseSpaceName } from "./spaces.js";

export function spaceNameHelpLines() {
  return [
    "name of this stack/space. files live at ~/.context101/spaces/<name>/",
    "later: context101 update <name>, urls <name>, destroy <name>",
    "lowercase letters, numbers, hyphens; start with a letter",
  ];
}

export function spaceNamePromptMessage() {
  return "space name";
}

export function spaceNamePromptOptions() {
  return {
    message: spaceNamePromptMessage(),
    help: spaceNameHelpLines().join("\n"),
    default: "",
  };
}

export function usingDefaultSpaceLine(name = DEFAULT_SPACE) {
  return `using space ${name} — ~/.context101/spaces/${name}/`;
}

export function initSpaceNameRequiredMessage() {
  return "init needs a space name (context101 init acme) or a TTY to ask";
}

export async function promptSpaceName() {
  const { input } = await import("@inquirer/prompts");
  return input({
    message: spaceNamePromptMessage(),
    validate: (value) => {
      try {
        parseSpaceName(value);
        return true;
      } catch (error) {
        return error.message;
      }
    },
  });
}

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

  let repository = defaults.repository || "";
  if (repository) {
    repository = normalizeRepoUrl(repository);
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
