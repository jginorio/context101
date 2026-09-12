import { DRIVER_NEON, DRIVER_POSTGRES } from "./defaults.js";

const FLAG_HELP = `
Usage: context101 init [options]

Walk a trusted-team self-host of Context101. Writes a gitignored
deploy-env. Does not run cdk deploy. Deploy only via ./cdk/deploy.sh.

  --dry-run              print the plan; write nothing, deploy nothing
  --yes, -y              accept defaults (needs --database-url or DATABASE_URL)
  --force                overwrite an existing env file
  --deploy-env <path>    default: <repo>/cdk/.deploy-env
  --home                 write ~/.context101/deploy-env instead
  --database-url <url>   Postgres URL (also reads DATABASE_URL)
  --database-driver      ${DRIVER_NEON} | ${DRIVER_POSTGRES}
  --database-prepare     true | false
  --aws-profile <name>   also reads AWS_PROFILE; required with --yes
                         when more than one profile exists
  --aws-access-key-id    used when no profile exists (also AWS_ACCESS_KEY_ID)
  --aws-secret-access-key
                         used when no profile exists (also AWS_SECRET_ACCESS_KEY)
  --repo <url>           watch this GitHub repo with Amplify
                         (default: skip Amplify, unless gh login is jginorio)
  --embed-model <id>     Bedrock embedding model (Amazon Titan or Cohere)
                         (default: amazon.titan-embed-text-v2:0; skip in the prompt)
  --seed                 print (or run) ./cdk/deploy.sh --seed
  --deploy               run ./cdk/deploy.sh after writing
                         (still asks unless combined with --yes)

From this checkout (after npm install):
  npm run context101 -- init
  npx context101 init
Dry-run: npm run context101 -- init --dry-run

npx context101 without a local install downloads Context7's MCP
from npm (unrelated) and fails with "too many arguments".
`.trim();

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
    databaseDriver: null,
    databasePrepare: null,
    awsProfile: null,
    awsAccessKeyId: null,
    awsSecretAccessKey: null,
    repo: null,
    embedModel: null,
  };

  const args = [...argv];
  if (args.length === 0) return opts;

  const first = args[0];
  if (first === "init") {
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
