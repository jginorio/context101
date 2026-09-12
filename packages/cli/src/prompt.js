import {
  CLAUDE_IMPROVE_MODEL,
  DEFAULT_AMPLIFY_REPO,
  DRIVER_NEON,
  DRIVER_POSTGRES,
  SMOOTH_REGION,
  TITAN_EMBED_MODEL,
} from "./defaults.js";
import { inferDriver, inferPrepare } from "./env-file.js";
import { defaultEnvPath } from "./repo.js";

export async function promptAnswers({ defaults, io }) {
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
  io.write("Bedrock model access (console → Model access):");
  io.dim(`  required  ${TITAN_EMBED_MODEL}`);
  io.dim(`  optional  ${CLAUDE_IMPROVE_MODEL}  — Improve + wiki. Wiki is paused; skip unless you want it.`);
  await confirm({ message: "Continue", default: true });

  const repository = await input({
    message: "GitHub repo Amplify should watch",
    default: defaults.repository || DEFAULT_AMPLIFY_REPO,
  });

  const databaseUrl = await password({
    message: "DATABASE_URL",
    mask: true,
    validate: (value) => (value ? true : "needed for the Postgres control plane"),
  });

  const inferredDriver = inferDriver(databaseUrl);
  const databaseDriver = await select({
    message: "DATABASE_DRIVER",
    default: inferredDriver,
    choices: [
      { name: `${DRIVER_NEON} (Neon)`, value: DRIVER_NEON },
      { name: `${DRIVER_POSTGRES} (Supabase / RDS / local)`, value: DRIVER_POSTGRES },
    ],
  });

  const databasePrepare = await confirm({
    message: "DATABASE_PREPARE (false for Supabase transaction pooler)",
    default: inferPrepare(databaseUrl),
  });

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
