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
import { normalizeRepoUrl } from "./repo.js";

export async function promptAnswers({ defaults, io, exec, env }) {
  const { confirm, input, password, select } = await import("@inquirer/prompts");

  io.write("This writes a local secrets file. Deploy afterwards with:");
  io.write("  npx context101 deploy");
  io.write("Press ^C to quit.");
  io.write("");

  const region = await input({
    message: "AWS region",
    default: defaults.region ?? SMOOTH_REGION,
  });
  if (region !== SMOOTH_REGION) {
    io.warn(`${SMOOTH_REGION} is the smooth path (S3 Vectors + Bedrock).`);
  }

  io.write("");
  io.write("Bedrock embedding models (console → Model access):");
  io.dim("  Request access for every embedding model brains can pick later.");
  io.dim(`  CDK default remains ${TITAN_EMBED_MODEL} unless you pass --embed-model.`);
  io.dim(`  Claude (${CLAUDE_IMPROVE_MODEL}) is optional for Improve. Wiki is paused.`);
  const catalog = listEmbeddingModels({ exec, env, region });
  if (catalog.warning) io.warn(catalog.warning);
  for (const model of catalog.models) {
    io.dim(`  · ${formatEmbeddingChoice(model)}`);
  }
  if (defaults.embedModelId) {
    io.dim(`  Default brain will use ${defaults.embedModelId} (--embed-model).`);
  }
  const requestBedrockAccess = await confirm({
    message: "Request access for all of these",
    default: true,
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

  return {
    region,
    repository,
    embedModelId: defaults.embedModelId || "",
    requestBedrockAccess,
    createRds,
    embeddingModels: catalog.models,
    databaseUrl,
    databaseDriver,
    databasePrepare,
    awsProfile: defaults.awsProfile ?? null,
    awsAccessKeyId: defaults.awsAccessKeyId ?? null,
    awsSecretAccessKey: defaults.awsSecretAccessKey ?? null,
  };
}
