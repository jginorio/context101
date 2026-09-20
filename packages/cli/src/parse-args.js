import { DRIVER_NEON, DRIVER_POSTGRES } from "./defaults.js";

const COMMAND_LINES = [
  ["init", "name a space and write its deploy-env; TTY asks to deploy"],
  ["update", "update a space from this CLI version"],
  ["deploy", "same as update"],
  ["diff", "cdk diff for a space"],
  ["synth", "cdk synth for a space"],
  ["list", "list spaces"],
  ["urls", "print public admin and MCP URLs"],
  ["destroy", "tear down a space"],
  ["config", "show deploy-env keys (values redacted)"],
  ["config set", "write one key (chmod 600; value is not printed)"],
  ["connectors", "TTY wizard to set up or update Google / Notion / GitHub App secrets"],
  ["connectors setup", "write instance OAuth/app secrets to SM (values not printed)"],
  ["help", "list commands"],
  ["version", "print the installed CLI version"],
];

const TOPIC_HELP = {
  init: `init [space] — name a space and write its deploy-env; TTY asks to deploy.
  No name: TTY asks (files at ~/.context101/spaces/<name>/). --yes / --dry-run use default. non-TTY needs a name.
  Existing deploy-env: TTY asks to keep it. No continues the wizard (same secrets). --force starts over (new secrets).
  Update later: pin the new CLI, then context101 update <space>.

  --dry-run
  --yes, -y              accept defaults (creates RDS if no --database-url);
                         required --aws-profile when several exist
  --force                overwrite an existing env file (new secrets)
  --deploy-env <path>    default: ~/.context101/spaces/<space>/deploy-env
  --home                 ~/.context101/deploy-env (legacy; migrates to default)
  --database-url <url>
  --create-rds           default when no URL
  --database-driver      ${DRIVER_NEON} | ${DRIVER_POSTGRES}
  --database-prepare     true | false
  --aws-profile <name>
  --aws-access-key-id
  --aws-secret-access-key
  --repo <url>           optional GitHub override (default is stack CodeCommit)
  --embed-model <id>
  --skip-bedrock-access
  --seed
  --deploy               deploy after writing without asking
  --verbose              dump cdk / npm / docker (default is a quiet spinner)`,

  deploy: `update [space] — update that space from this CLI version.
  One space: updates it. Several: TTY pick, or pass a name. Pin a new CLI first.
  Also: deploy.

  --seed
  --deploy-env <path>
  --home
  --dry-run
  --verbose              dump cdk / npm / docker (default is a quiet spinner)`,

  diff: `diff [space] — cdk diff for a space (same context as deploy)

  --seed
  --deploy-env <path>
  --home
  --dry-run
  --verbose`,

  synth: `synth [space] — cdk synth for a space (same context as deploy)

  --seed
  --deploy-env <path>
  --home
  --dry-run
  --verbose`,

  list: `list — list Context101 spaces (no checkout)

  --aws-profile <name>
  --aws-access-key-id
  --aws-secret-access-key`,

  urls: `urls [space] — print public admin and MCP URLs for a space
  One space: prints it. Several: TTY pick, or pass a name.
  Also: url.

  --aws-profile <name>
  --aws-access-key-id
  --aws-secret-access-key`,

  destroy: `destroy [space] — tear down a space

  --yes, -y
  --aws-profile <name>
  --aws-access-key-id
  --aws-secret-access-key
  --deploy-env <path>
  --home
  --dry-run
  --verbose`,

  config: `config — show deploy-env keys (values redacted)

  --deploy-env <path>
  --home`,

  "config set": `config set KEY=value — write one key (chmod 600; value is not printed)

  --deploy-env <path>
  --home`,

  connectors: `connectors [space] — TTY wizard to set up or update Google / Notion / GitHub App secrets
  TTY: pick a space (if several), then a provider. Status is configured when deploy-env has
  the *_SECRET_ID key and/or Secrets Manager can describe the expected name (name only).
  Not configured: steps to create the provider app, then prompts for credentials.
  Configured: safe summary (env key, SM name, region), then update / leave / show steps.
  --dry-run on a TTY: same menus. Unconfigured: steps + would-write names, no secret prompts.
  Configured Update: field prompts then would-write names. Never writes SM.
  No TTY: prints this help. Scripts: context101 connectors setup <google|notion|github>.
  Google: { client_id, client_secret, optional picker_api_key / picker_app_id }
  at <NAME_PREFIX>-google-oauth-client. Writes merge existing SM JSON (get first).
  Omit picker flags / empty prompt keeps prior picker keys. --clear-picker drops them.
  Notion: { client_id, client_secret } at <NAME_PREFIX>-notion-oauth-client.
  GitHub App: <NAME_PREFIX>-connector-github-app. PAT is per-connector in admin, not here.
  Writes the SM name to deploy-env as GOOGLE_OAUTH_CLIENT_SECRET_ID / NOTION_OAUTH_CLIENT_SECRET_ID / GITHUB_APP_SECRET_ID.
  Values are never printed. Next: context101 update, then Connect in admin.

  --client-id
  --client-secret        or env CONTEXT101_CONNECTOR_CLIENT_SECRET
  --picker-api-key       Google Picker Browser API key (optional; omit keeps existing)
                         or env CONTEXT101_GOOGLE_PICKER_API_KEY
  --picker-app-id        Google Cloud project number (optional; omit keeps existing)
                         or env CONTEXT101_GOOGLE_PICKER_APP_ID
  --clear-picker         drop picker_api_key / picker_app_id from the Google secret
  --app-id               GitHub App id
  --private-key-file     GitHub App PEM
  --slug                 GitHub App slug (optional)
  --html-url             GitHub App URL (optional)
  --aws-profile <name>
  --deploy-env <path>
  --home
  --dry-run
  --yes, -y`,

  "connectors setup": `connectors setup <google|notion|github> [space] — write instance OAuth/app secrets to Secrets Manager
  Also: context101 connectors (TTY wizard).
  Google writes merge existing SM JSON. --picker-api-key / --picker-app-id are optional;
  omit or empty keeps prior picker keys. --clear-picker drops them. Values never printed.

  --client-id
  --client-secret        or env CONTEXT101_CONNECTOR_CLIENT_SECRET
  --picker-api-key       or env CONTEXT101_GOOGLE_PICKER_API_KEY
  --picker-app-id        or env CONTEXT101_GOOGLE_PICKER_APP_ID
  --clear-picker
  --app-id               GitHub App id
  --private-key-file     GitHub App PEM
  --aws-profile <name>
  --deploy-env <path>
  --home
  --dry-run
  --yes, -y`,

  help: `help [command] — list commands, or flags for one command`,

  version: `version - print the installed CLI version

  Also: -v, --version. Child-process dumps use --verbose (not -v).`,
};

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

const CDK_FROM_INIT = new Set(["--dir"]);

const CDK_COMMANDS = new Set(["deploy", "diff", "synth"]);
const TARGET_COMMANDS = new Set([
  "init",
  "deploy",
  "diff",
  "synth",
  "destroy",
  "urls",
  "connectors",
]);

const COMMANDS = {
  init: "init",
  update: "deploy",
  deploy: "deploy",
  diff: "diff",
  synth: "synth",
  list: "list",
  ls: "list",
  urls: "urls",
  url: "urls",
  destroy: "destroy",
  remove: "destroy",
  rm: "destroy",
  config: "config",
  connectors: "connectors",
  help: "help",
  version: "version",
};

export function helpText(topic) {
  if (topic) {
    const key = COMMANDS[topic] ?? topic;
    return TOPIC_HELP[key] ?? helpText();
  }
  const nameW = Math.max(...COMMAND_LINES.map(([name]) => name.length));
  return [
    "Usage: context101 <command>",
    "",
    ...COMMAND_LINES.map(([name, desc]) => `  ${name.padEnd(nameW)}  ${desc}`),
    "",
    "npx context101 (unscoped) is Context7's MCP — use context101-cli.",
  ].join("\n");
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
    space: null,
    stackName: null,
    verbose: false,
    configAction: "show",
    configKey: null,
    configValue: null,
    connectorsAction: null,
    connectorsProvider: null,
    clientId: null,
    clientSecret: null,
    pickerApiKey: null,
    pickerAppId: null,
    clearPicker: false,
    appId: null,
    slug: null,
    htmlUrl: null,
    privateKeyFile: null,
    helpTopic: null,
  };

  const args = [...argv];
  if (args.length === 0) return opts;

  const first = args[0];
  if (first === "--help" || first === "-h") {
    opts.command = "help";
    opts.help = true;
    args.shift();
  } else if (first === "--version" || first === "-v") {
    opts.command = "version";
    args.shift();
  } else if (COMMANDS[first]) {
    opts.command = COMMANDS[first];
    args.shift();
  } else if (!first.startsWith("-")) {
    const err = new Error(`unknown command: ${first}`);
    err.code = "USAGE";
    throw err;
  }

  if (opts.command === "help") {
    return parseHelpArgs(opts, args);
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

  if (opts.command === "connectors") {
    parseConnectorsArgs(opts, args);
  }

  while (args.length) {
    const arg = args.shift();
    if (TARGET_COMMANDS.has(opts.command) && !arg.startsWith("-")) {
      if (opts.space || opts.stackName) {
        const err = new Error(`${opts.command} takes one space name`);
        err.code = "USAGE";
        throw err;
      }
      opts.space = arg;
      opts.stackName = arg;
      continue;
    }
    if (!flagAllowed(opts.command, arg)) {
      const err = new Error(
        CONNECTOR_ONLY.has(arg)
          ? `${arg} is a connectors option`
          : opts.command === "init"
            ? `unknown flag: ${arg}`
            : `${arg} is an init option`
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
      case "--version":
      case "-v":
        if (opts.command !== "version") {
          const err = new Error(`unknown flag: ${arg}`);
          err.code = "USAGE";
          throw err;
        }
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
      case "--verbose":
        opts.verbose = true;
        break;
      case "--client-id":
        opts.clientId = needValue(arg, args);
        break;
      case "--client-secret":
        opts.clientSecret = needValue(arg, args);
        break;
      case "--picker-api-key":
        opts.pickerApiKey = needValue(arg, args);
        break;
      case "--picker-app-id":
        opts.pickerAppId = needValue(arg, args);
        break;
      case "--clear-picker":
        opts.clearPicker = true;
        break;
      case "--app-id":
        opts.appId = needValue(arg, args);
        break;
      case "--slug":
        opts.slug = needValue(arg, args);
        break;
      case "--html-url":
        opts.htmlUrl = needValue(arg, args);
        break;
      case "--private-key-file":
        opts.privateKeyFile = needValue(arg, args);
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

function parseHelpArgs(opts, args) {
  opts.help = true;
  if (args[0] && !args[0].startsWith("-")) {
    const topic = args.shift();
    if (topic === "config" && args[0] === "set") {
      args.shift();
      opts.helpTopic = "config set";
    } else if (topic === "connectors" && args[0] === "setup") {
      args.shift();
      opts.helpTopic = "connectors setup";
    } else if (COMMANDS[topic] && topic !== "help") {
      opts.helpTopic = COMMANDS[topic];
    } else if (topic === "help") {
      opts.helpTopic = "help";
    } else {
      const err = new Error(`unknown command: ${topic}`);
      err.code = "USAGE";
      throw err;
    }
  }
  while (args.length) {
    const arg = args.shift();
    if (arg === "--help" || arg === "-h") continue;
    const err = new Error(`unknown flag: ${arg}`);
    err.code = "USAGE";
    throw err;
  }
  return opts;
}

const CONNECTOR_ONLY = new Set([
  "--client-id",
  "--client-secret",
  "--picker-api-key",
  "--picker-app-id",
  "--clear-picker",
  "--app-id",
  "--slug",
  "--html-url",
  "--private-key-file",
]);

function parseConnectorsArgs(opts, args) {
  const action = args[0] && !args[0].startsWith("-") ? args[0] : null;
  if (action === "setup") {
    args.shift();
    opts.connectorsAction = "setup";
    if (args[0] && !args[0].startsWith("-")) {
      opts.connectorsProvider = args.shift();
    }
    return;
  }
  opts.connectorsAction = null;
}

function flagAllowed(command, arg) {
  if (CONNECTOR_ONLY.has(arg)) return command === "connectors";
  if (!INIT_ONLY.has(arg)) return true;
  if (command === "init") return true;
  if (command === "destroy") return DESTROY_FROM_INIT.has(arg);
  if (CDK_COMMANDS.has(command)) return CDK_FROM_INIT.has(arg);
  if (command === "list" || command === "urls") return LIST_FROM_INIT.has(arg);
  if (command === "config") return arg === "--home";
  if (command === "connectors") {
    return LIST_FROM_INIT.has(arg) || arg === "--yes" || arg === "-y";
  }
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
