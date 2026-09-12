import {
  CLAUDE_IMPROVE_MODEL,
  DRIVER_NEON,
  DRIVER_POSTGRES,
  SMOOTH_REGION,
  TITAN_EMBED_MODEL,
} from "./defaults.js";
import {
  formatEmbeddingChoice,
  listEmbeddingModels,
} from "./embedding-models.js";
import { inferDriver, inferPrepare } from "./env-file.js";
import { defaultEnvPath, normalizeRepoUrl } from "./repo.js";

export async function promptAnswers({ defaults, io, exec, env }) {
  const { confirm, input, password, select } = await import("@inquirer/prompts");

  io.write("This writes a gitignored deploy-env and prints the deploy command.");
  io.write("It will not run cdk deploy. Press ^C to quit.");
  io.write("");

  const region = await input({
    message: "AWS region",
    default: defaults.region ?? SMOOTH_REGION,
  });
  if (region !== SMOOTH_REGION) {
    io.warn(`${SMOOTH_REGION} is the smooth path (S3 Vectors + Bedrock).`);
  }

  io.write("");
  io.write("Bedrock embedding model (console → Model access):");
  io.dim(`  Skip keeps ${TITAN_EMBED_MODEL} (CDK default; you can change it later in the app).`);
  io.dim(`  Claude (${CLAUDE_IMPROVE_MODEL}) is optional for Improve. Wiki is paused.`);
  const catalog = listEmbeddingModels({ exec, env, region });
  if (catalog.warning) io.warn(catalog.warning);
  const embedModelId = await select({
    message: "Embedding model",
    default: defaults.embedModelId || "",
    choices: [
      {
        name: `Skip — ${TITAN_EMBED_MODEL} (default)`,
        value: "",
      },
      ...catalog.models.map((model) => ({
        name: formatEmbeddingChoice(model),
        value: model.id,
      })),
    ],
  });

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
    default: defaults.databaseUrl ? "url" : "rds",
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

  const envChoice = await select({
    message: "Write deploy-env to",
    default: "repo",
    choices: [
      { name: "cdk/.deploy-env (this repo)", value: "repo" },
      { name: "~/.context101/deploy-env (this user)", value: "home" },
    ],
  });

  const seed = await confirm({
    message: "First deploy? Include --seed (uploads knowledge/ once)",
    default: false,
  });

  const deploy = await confirm({
    message: "Run ./cdk/deploy.sh after writing? (default is print the command)",
    default: false,
  });

  const extras = await select({
    message: "Optional last steps",
    default: "skip",
    choices: [
      { name: "Skip (recommended)", value: "skip" },
      { name: "Show connector + wiki notes only", value: "notes" },
    ],
  });

  return {
    region,
    repository,
    embedModelId,
    createRds,
    embeddingModels: catalog.models,
    databaseUrl,
    databaseDriver,
    databasePrepare,
    awsProfile: defaults.awsProfile ?? null,
    awsAccessKeyId: defaults.awsAccessKeyId ?? null,
    awsSecretAccessKey: defaults.awsSecretAccessKey ?? null,
    home: envChoice === "home",
    envFile: envChoice === "home" ? defaultEnvPath(defaults.repoRoot, { home: true }) : null,
    seed,
    deploy,
    extras,
  };
}

export function optionalNotes() {
  return [
    "Optional later:",
    "  · Connector OAuth secrets (Google / Notion) — README, after the Amplify domain exists.",
    "  · Wiki overlay is paused/beta. Use Refresh now on /wiki if you want it.",
    "    Do not turn the EventBridge wiki schedule or AUTO_TRIGGER_CODE_WIKI back on.",
  ].join("\n");
}
