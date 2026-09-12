import { DRIVER_NEON, DRIVER_POSTGRES } from "./defaults.js";

const FLAG_HELP = `
Usage: context101 <command> [options]

  init                 write a local secrets file (default); TTY asks to deploy
  deploy               deploy the AWS stack (loads deploy-env, invokes cdk)
  diff                 cdk diff with the same context flags
  synth                cdk synth with the same context flags
  list, ls             list Context101 CloudFormation deployments (no checkout)
  destroy, remove, rm  tear down a listed stack (name required; clones if needed)
  config               show deploy-env keys (values redacted; no checkout)
  config set KEY=value write one key (chmod 600; value is not printed)

CDK fails closed: a bare \`cdk deploy\` without \`-c token=\` throws
instead of deleting MCP / Amplify. The CLI is the front door.

  context101 init
  context101 deploy
  npx context101-cli init
  npx context101-cli deploy

  --dry-run              print the plan; write nothing, deploy nothing
  --yes, -y              accept defaults (creates RDS if no --database-url);
                         does not deploy unless --deploy is also passed
  --force                overwrite an existing env file
  --dir <path>           clone into this directory when not in a checkout
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
  --deploy               deploy after writing without asking

deploy / diff / synth:
  --seed                 upload knowledge/ once (first deploy only)
  --deploy-env <path>
  --home
  --dry-run              print the command; invoke nothing

list:
  --aws-profile <name>
  --aws-access-key-id
  --aws-secret-access-key

destroy <StackName>:
  --yes, -y              skip the confirmation prompt
  --aws-profile <name>
  --aws-access-key-id
  --aws-secret-access-key
  --dir <path>           clone here when no checkout (default ~/.context101/src)
  --deploy-env <path>
  --home
  --dry-run              print the plan; destroy nothing

config:
  --deploy-env <path>
  --home                 ~/.context101/deploy-env (also the default outside a checkout)

From this checkout (after npm install):
  npm run context101 -- init
  npm run context101 -- deploy
  npx context101-cli init
  npx context101-cli deploy
  context101 list
  context101 destroy Context101Stack
  context101 config

npx context101 (unscoped) downloads Context7's MCP from npm — unrelated.
The publishable CLI is context101-cli; the bin name is context101.
`.trim();

const INIT_ONLY = new Set([
  "--yes",
  "-y",
  "--force",
  "--deploy",
  "--dir",
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

const DESTROY_FROM_INIT = new Set([
  "--yes",
  "-y",
  "--dir",
  "--aws-profile",
  "--aws-access-key-id",
  "--aws-secret-access-key",
]);

const LIST_FROM_INIT = new Set([
  "--aws-profile",
  "--aws-access-key-id",
  "--aws-secret-access-key",
]);

const CDK_COMMANDS = new Set(["deploy", "diff", "synth"]);

const COMMANDS = {
  init: "init",
  deploy: "deploy",
  diff: "diff",
  synth: "synth",
  list: "list",
  ls: "list",
  destroy: "destroy",
  remove: "destroy",
  rm: "destroy",
  config: "config",
};

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
    dir: null,
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
    stackName: null,
    configAction: "show",
    configKey: null,
    configValue: null,
  };

  const args = [...argv];
  if (args.length === 0) return opts;

  const first = args[0];
  if (COMMANDS[first]) {
    opts.command = COMMANDS[first];
    args.shift();
  } else if (first === "help" || first === "--help" || first === "-h") {
    opts.help = true;
    return opts;
  } else if (!first.startsWith("-")) {
    const err = new Error(`unknown command: ${first}`);
    err.code = "USAGE";
    throw err;
  }

  if (opts.command === "config" && args[0] === "set") {
    args.shift();
    const pair = args.shift();
    if (!pair || !pair.includes("=")) {
      const err = new Error("usage: context101 config set KEY=value");
      err.code = "USAGE";
      throw err;
    }
    const eq = pair.indexOf("=");
    opts.configAction = "set";
    opts.configKey = pair.slice(0, eq);
    opts.configValue = pair.slice(eq + 1);
  }

  while (args.length) {
    const arg = args.shift();
    if (opts.command === "destroy" && !arg.startsWith("-")) {
      if (opts.stackName) {
        const err = new Error("destroy takes one stack name");
        err.code = "USAGE";
        throw err;
      }
      opts.stackName = arg;
      continue;
    }
    if (!flagAllowed(opts.command, arg)) {
      const err = new Error(
        opts.command === "init" ? `unknown flag: ${arg}` : `${arg} is an init option`
      );
      err.code = "USAGE";
      throw err;
    }
    if (arg === "--seed" && !CDK_COMMANDS.has(opts.command) && opts.command !== "init") {
      const err = new Error(`--seed is a deploy option`);
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
      case "--dir":
        opts.dir = needValue(arg, args);
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

function flagAllowed(command, arg) {
  if (!INIT_ONLY.has(arg)) return true;
  if (command === "init") return true;
  if (command === "destroy") return DESTROY_FROM_INIT.has(arg);
  if (command === "list") return LIST_FROM_INIT.has(arg);
  if (command === "config") return arg === "--home";
  return false;
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
