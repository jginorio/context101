import { DRIVER_NEON, DRIVER_POSTGRES } from "./defaults.js";

const FLAG_HELP = `
Usage: context101 <command> [options]

  init      write a local secrets file (default if you omit the command)
  deploy    deploy the AWS stack

init walks a trusted-team self-host and writes a gitignored secrets
file. It does not deploy unless you pass --deploy. When you are ready:

  npm run context101 -- deploy
  npx context101 deploy

  --dry-run              print the plan; write nothing, deploy nothing
  --yes, -y              accept defaults (creates RDS if no --database-url)
  --force                overwrite an existing env file
  --deploy-env <path>    default: <repo>/cdk/.deploy-env
  --home                 write ~/.context101/deploy-env instead
  --database-url <url>   Postgres URL (also reads DATABASE_URL)
  --create-rds           CDK provisions RDS Postgres (default when no URL)
  --database-driver      ${DRIVER_NEON} | ${DRIVER_POSTGRES}
  --database-prepare     true | false
  --aws-profile <name>   also reads AWS_PROFILE; required with --yes
                         when more than one profile exists
  --aws-access-key-id    used when no profile exists (also AWS_ACCESS_KEY_ID)
  --aws-secret-access-key
                         used when no profile exists (also AWS_SECRET_ACCESS_KEY)
  --repo <url>           watch this GitHub repo with Amplify
                         (default: skip Amplify, unless gh login is jginorio)
  --embed-model <id>     optional CDK default embedding model
                         (brains still pick any Titan/Cohere model in the app)
  --skip-bedrock-access  do not request Bedrock model access during init
  --seed                 first deploy uploads knowledge/ once
  --deploy               deploy after writing (combine with --yes)

deploy:
  --seed                 upload knowledge/ once (first deploy only)
  --deploy-env <path>
  --home
  --dry-run              print the command; deploy nothing

From this checkout (after npm install):
  npm run context101 -- init
  npm run context101 -- deploy
  npx context101 init
  npx context101 deploy

npx context101 without a local install downloads Context7's MCP
from npm (unrelated) and fails with "too many arguments".
`.trim();

const INIT_ONLY = new Set([
  "--yes",
  "-y",
  "--force",
  "--deploy",
  "--database-url",
  "--create-rds",
  "--database-driver",
  "--database-prepare",
  "--aws-profile",
  "--aws-access-key-id",
  "--aws-secret-access-key",
  "--repo",
  "--embed-model",
  "--skip-bedrock-access",
]);

export function helpText() {
  return FLAG_HELP;
}

export function parseArgs(argv) {
  const opts = {
    command: "init",
    help: false,
    dryRun: false,
    yes: false,
    force: false,
    deploy: false,
    seed: false,
    home: false,
    envFile: null,
    databaseUrl: null,
    createRds: false,
    databaseDriver: null,
    databasePrepare: null,
    awsProfile: null,
    awsAccessKeyId: null,
    awsSecretAccessKey: null,
    repo: null,
    embedModel: null,
    skipBedrockAccess: false,
  };

  const args = [...argv];
  if (args.length === 0) return opts;

  const first = args[0];
  if (first === "init") {
    args.shift();
  } else if (first === "deploy") {
    opts.command = "deploy";
    args.shift();
  } else if (first === "help" || first === "--help" || first === "-h") {
    opts.help = true;
    return opts;
  } else if (!first.startsWith("-")) {
    const err = new Error(`unknown command: ${first}`);
    err.code = "USAGE";
    throw err;
  }

  while (args.length) {
    const arg = args.shift();
    if (opts.command === "deploy" && INIT_ONLY.has(arg)) {
      const err = new Error(`${arg} is an init option`);
      err.code = "USAGE";
      throw err;
    }
    switch (arg) {
      case "--help":
      case "-h":
        opts.help = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--yes":
      case "-y":
        opts.yes = true;
        break;
      case "--force":
        opts.force = true;
        break;
      case "--deploy":
        opts.deploy = true;
        break;
      case "--seed":
        opts.seed = true;
        break;
      case "--home":
        opts.home = true;
        break;
      case "--deploy-env":
        opts.envFile = needValue(arg, args);
        break;
      case "--database-url":
        opts.databaseUrl = needValue(arg, args);
        break;
      case "--create-rds":
        opts.createRds = true;
        break;
      case "--database-driver":
        opts.databaseDriver = parseDriver(needValue(arg, args));
        break;
      case "--database-prepare":
        opts.databasePrepare = parseBool(needValue(arg, args));
        break;
      case "--aws-profile":
        opts.awsProfile = needValue(arg, args);
        break;
      case "--aws-access-key-id":
        opts.awsAccessKeyId = needValue(arg, args);
        break;
      case "--aws-secret-access-key":
        opts.awsSecretAccessKey = needValue(arg, args);
        break;
      case "--repo":
        opts.repo = needValue(arg, args);
        break;
      case "--embed-model":
        opts.embedModel = needValue(arg, args);
        break;
      case "--skip-bedrock-access":
        opts.skipBedrockAccess = true;
        break;
      default: {
        const err = new Error(`unknown flag: ${arg}`);
        err.code = "USAGE";
        throw err;
      }
    }
  }

  return opts;
}

function needValue(flag, args) {
  const value = args.shift();
  if (!value || value.startsWith("-")) {
    const err = new Error(`${flag} needs a value`);
    err.code = "USAGE";
    throw err;
  }
  return value;
}

function parseDriver(value) {
  if (value === DRIVER_NEON || value === DRIVER_POSTGRES) return value;
  const err = new Error(
    `--database-driver must be ${DRIVER_NEON} or ${DRIVER_POSTGRES}`
  );
  err.code = "USAGE";
  throw err;
}

function parseBool(value) {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  const err = new Error(`--database-prepare must be true or false`);
  err.code = "USAGE";
  throw err;
}
