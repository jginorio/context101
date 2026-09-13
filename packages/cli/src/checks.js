import { SMOOTH_REGION } from "./defaults.js";
import { commandExists } from "./exec.js";
import { ensureDockerDaemon } from "./docker.js";

/** Amplify CreateApp calls GitHub list-repository-webhooks with this token. */
export function classifyGithubToken(token) {
  const value = String(token ?? "").trim();
  if (!value) return "missing";
  if (value.startsWith("ghp_")) return "classic_pat";
  if (value.startsWith("github_pat_")) return "fine_grained_pat";
  if (value.startsWith("ghs_")) return "installation";
  if (value.startsWith("gho_")) return "oauth";
  if (value.startsWith("ghu_")) return "user_to_server";
  return "unknown";
}

export function githubTokenWorksForAmplify(kind) {
  return kind === "classic_pat" || kind === "fine_grained_pat";
}

function versionOf(exec, command, args, pattern) {
  const result = exec({ command, args });
  if (!result.ok) return null;
  const text = `${result.stdout}\n${result.stderr}`;
  const match = text.match(pattern);
  return match ? match[1] : text.split("\n")[0];
}

export function runChecks({
  exec,
  env = {},
  region = SMOOTH_REGION,
  platform,
  dryRun = false,
  wait,
} = {}) {
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
  const nodeOk = nodeMajor >= 20;
  const npmVersion = versionOf(exec, "npm", ["-v"], /^(\d+\.\d+\.\d+)/m);
  const awsVersion = versionOf(exec, "aws", ["--version"], /aws-cli\/(\S+)/);
  const docker = ensureDockerDaemon({ exec, platform, dryRun, wait });
  const ghOk = commandExists(exec, "gh");

  let awsIdentity = null;
  if (awsVersion) {
    const identity = exec({
      command: "aws",
      args: ["sts", "get-caller-identity", "--output", "json"],
      env,
    });
    if (identity.ok) {
      try {
        const parsed = JSON.parse(identity.stdout);
        awsIdentity = {
          account: parsed.Account ?? "",
          arn: parsed.Arn ?? "",
        };
      } catch {
        awsIdentity = { account: "", arn: "" };
      }
    }
  }

  let bootstrapped = null;
  if (awsIdentity) {
    const stack = exec({
      command: "aws",
      args: [
        "cloudformation",
        "describe-stacks",
        "--stack-name",
        "CDKToolkit",
        "--region",
        region,
        "--query",
        "Stacks[0].StackStatus",
        "--output",
        "text",
      ],
      env,
    });
    bootstrapped = stack.ok && /CREATE_COMPLETE|UPDATE_COMPLETE/.test(stack.stdout);
  }

  let ghLoggedIn = false;
  let ghTokenKind = "missing";
  if (ghOk) {
    const token = exec({ command: "gh", args: ["auth", "token"] });
    ghLoggedIn = token.ok && token.stdout.trim().length > 0;
    if (ghLoggedIn) ghTokenKind = classifyGithubToken(token.stdout);
  }

  return {
    node: { ok: nodeOk, version: process.versions.node },
    npm: { ok: Boolean(npmVersion), version: npmVersion },
    aws: { ok: Boolean(awsVersion), version: awsVersion, identity: awsIdentity },
    docker,
    gh: {
      ok: ghOk,
      loggedIn: ghLoggedIn,
      tokenKind: ghTokenKind,
      amplifyOk: githubTokenWorksForAmplify(ghTokenKind),
    },
    bootstrap: { ok: bootstrapped, region },
  };
}

export function printChecks(checks, io) {
  const { ok, warn, dim } = io;
  const nodeLine = checks.node.ok
    ? `node ${checks.node.version}`
    : `node ${checks.node.version} (need 20+)`;
  (checks.node.ok ? ok : warn)(nodeLine);
  (checks.npm.ok ? ok : warn)(checks.npm.ok ? `npm ${checks.npm.version}` : "npm not found");
  if (checks.aws.ok && checks.aws.identity) {
    ok(`aws ${checks.aws.version}  account ${checks.aws.identity.account}`);
  } else if (checks.aws.ok) {
    warn(`aws ${checks.aws.version} — sts get-caller-identity failed`);
  } else {
    warn("aws cli not found");
  }
  if (checks.awsProfile) {
    ok(`AWS profile ${checks.awsProfile}`);
  } else if (checks.hasAwsKeys) {
    ok("AWS access keys (no profile)");
  } else if (checks.awsProfiles?.length > 1) {
    warn(
      `${checks.awsProfiles.length} AWS profiles (${checks.awsProfiles.join(", ")}) — pick one`
    );
  } else if (checks.awsProfiles?.length === 0) {
    warn("no AWS profiles — will ask for access key and secret");
  }
  printDockerCheck(checks.docker, { ok, warn });
  if (checks.gh.ok && checks.gh.amplifyOk) {
    ok("gh (logged in with a PAT — usable if you pass --repo)");
  } else if (checks.gh.ok && checks.gh.loggedIn) {
    dim(
      `gh token is ${checks.gh.tokenKind} — set CTX_GH_TOKEN=ghp_… only if you pass --repo`
    );
  } else if (checks.gh.ok) {
    dim("gh found but not logged in — set CTX_GH_TOKEN only if you pass --repo");
  } else {
    dim("gh optional — admin uses CodeCommit unless you pass --repo");
  }
}

function printDockerCheck(docker, { ok, warn }) {
  if (!docker) {
    warn("docker not found (needed for CDK image assets)");
    return;
  }
  if (!docker.installed) {
    warn("docker not found (needed for CDK image assets)");
    return;
  }
  if (docker.daemon && docker.started) {
    ok(`docker (started ${docker.starter})`);
    return;
  }
  if (docker.daemon) {
    ok("docker");
    return;
  }
  warn("docker daemon is not running (needed for CDK image assets)");
}
