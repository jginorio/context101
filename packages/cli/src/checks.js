import { SMOOTH_REGION } from "./defaults.js";
import { commandExists } from "./exec.js";

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

export function runChecks({ exec, env = {}, region = SMOOTH_REGION }) {
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
  const nodeOk = nodeMajor >= 20;
  const npmVersion = versionOf(exec, "npm", ["-v"], /^(\d+\.\d+\.\d+)/m);
  const awsVersion = versionOf(exec, "aws", ["--version"], /aws-cli\/(\S+)/);
  const dockerOk = commandExists(exec, "docker");
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
    docker: { ok: dockerOk },
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
  (checks.docker.ok ? ok : warn)(checks.docker.ok ? "docker" : "docker not found (needed for CDK image assets)");
  if (checks.gh.ok && checks.gh.amplifyOk) {
    ok("gh (logged in with a PAT — deploy.sh can use it for Amplify)");
  } else if (checks.gh.ok && checks.gh.loggedIn) {
    warn(
      `gh token is ${checks.gh.tokenKind} — Amplify needs CTX_GH_TOKEN=ghp_… (repo webhooks)`
    );
  } else if (checks.gh.ok) {
    warn("gh found but not logged in — set CTX_GH_TOKEN before deploy");
  } else {
    dim("gh optional — set CTX_GH_TOKEN in the env file if you skip it");
  }
}
