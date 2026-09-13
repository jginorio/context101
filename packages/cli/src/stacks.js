import { homedir } from "node:os";
import { DESTROY_CLI, LIST_CLI, SMOOTH_REGION } from "./defaults.js";
import { runCdk } from "./cdk-invoke.js";
import { createExec } from "./exec.js";
import { createProgress, LABEL_DESTROYING } from "./progress.js";
import {
  findSpaceByTarget,
  listSpaces,
  resolveSelectedSpace,
} from "./spaces.js";
import { ensureStackRoot } from "./stack-source.js";
import { writers } from "./style.js";

export function parseStackSummaries(payload) {
  const rows = payload?.StackSummaries;
  return Array.isArray(rows) ? rows : [];
}

export function isContext101Deployment(stack) {
  if (!stack || stack.ParentId) return false;
  if (String(stack.StackStatus || "") === "DELETE_COMPLETE") return false;
  const name = String(stack.StackName || "");
  const desc = String(stack.TemplateDescription || "");
  return /context101/i.test(name) || /context101/i.test(desc);
}

export function listDeployments({ exec, env, region = SMOOTH_REGION } = {}) {
  if (!exec) {
    return { ok: false, stacks: [], error: "aws cli not available" };
  }
  const result = exec({
    command: "aws",
    args: ["cloudformation", "list-stacks", "--region", region, "--output", "json"],
    env,
  });
  if (!result.ok) {
    return {
      ok: false,
      stacks: [],
      error: result.stderr || result.stdout || "aws cloudformation list-stacks failed",
    };
  }
  try {
    const stacks = parseStackSummaries(JSON.parse(result.stdout || "{}")).filter(
      isContext101Deployment
    );
    stacks.sort((a, b) => String(a.StackName).localeCompare(String(b.StackName)));
    return { ok: true, stacks, error: null };
  } catch {
    return { ok: false, stacks: [], error: "could not parse cloudformation list-stacks" };
  }
}

export function statusTone(status, colors = {}) {
  const s = String(status);
  if (/FAIL|ROLLBACK/i.test(s)) return colors.red ?? "";
  if (/IN_PROGRESS|PENDING|REVIEW/i.test(s)) return colors.violet ?? "";
  if (/COMPLETE/i.test(s)) return colors.magenta ?? "";
  return colors.violet ?? "";
}

export function formatDeployments(stacks, { region = SMOOTH_REGION, colors } = {}) {
  const c = colors ?? { magenta: "", violet: "", dim: "", red: "", bold: "", reset: "" };
  if (!stacks.length) {
    return [`No Context101 spaces in ${region}.`, `Next: context101 init`].join("\n");
  }
  const nameW = Math.max(4, ...stacks.map((s) => String(s.StackName).length));
  const statusW = Math.max(6, ...stacks.map((s) => String(s.StackStatus).length));
  const lines = [
    `${c.dim}Context101 spaces in ${region}${c.reset}`,
    "",
    `${c.dim}${"NAME".padEnd(nameW)}  ${"STATUS".padEnd(statusW)}  UPDATED${c.reset}`,
  ];
  for (const stack of stacks) {
    const updated = stack.LastUpdatedTime || stack.CreationTime || "";
    const tone = statusTone(stack.StackStatus, c);
    lines.push(
      `${String(stack.StackName).padEnd(nameW)}  ${tone}${String(stack.StackStatus).padEnd(statusW)}${c.reset}  ${c.dim}${updated}${c.reset}`
    );
  }
  return lines.join("\n");
}

export function formatSpaces(rows, { colors } = {}) {
  const c = colors ?? { magenta: "", violet: "", dim: "", red: "", bold: "", reset: "" };
  if (!rows.length) {
    return [`No Context101 spaces.`, `Next: context101 init`].join("\n");
  }
  const spaceW = Math.max(5, ...rows.map((row) => String(row.name).length));
  const stackW = Math.max(5, ...rows.map((row) => String(row.stackName).length));
  const statusW = Math.max(6, ...rows.map((row) => String(row.status || "—").length));
  const lines = [
    `${c.dim}Context101 spaces${c.reset}`,
    "",
    `${c.dim}${"SPACE".padEnd(spaceW)}  ${"STACK".padEnd(stackW)}  ${"STATUS".padEnd(statusW)}  UPDATED${c.reset}`,
  ];
  for (const row of rows) {
    const tone = statusTone(row.status, c);
    lines.push(
      `${String(row.name).padEnd(spaceW)}  ${String(row.stackName).padEnd(stackW)}  ${tone}${String(row.status || "—").padEnd(statusW)}${c.reset}  ${c.dim}${row.updated || ""}${c.reset}`
    );
  }
  return lines.join("\n");
}

export async function runList(opts, ctx) {
  const io = writers(ctx);
  const exec = ctx.exec ?? createExec(ctx.env);
  const homeDir = ctx.homeDir ?? homedir();
  const spaces = listSpaces({ homeDir, cwd: ctx.cwd });

  if (spaces.length) {
    const rows = spaces.map((space) => {
      const env = withAwsAuth(ctx.env ?? {}, {
        profile: opts.awsProfile || space.awsProfile,
        accessKeyId: opts.awsAccessKeyId || space.values.AWS_ACCESS_KEY_ID,
        secretAccessKey: opts.awsSecretAccessKey || space.values.AWS_SECRET_ACCESS_KEY,
      });
      const listed = listDeployments({
        exec,
        env,
        region: space.region || SMOOTH_REGION,
      });
      const match = listed.ok
        ? listed.stacks.find((stack) => stack.StackName === space.stackName)
        : null;
      return {
        name: space.name,
        stackName: space.stackName,
        status: match?.StackStatus || "",
        updated: match?.LastUpdatedTime || match?.CreationTime || "",
      };
    });
    io.write(formatSpaces(rows, { colors: io.c }));
    io.write("");
    return 0;
  }

  const env = withAwsAuth(ctx.env ?? {}, {
    profile: opts.awsProfile,
    accessKeyId: opts.awsAccessKeyId,
    secretAccessKey: opts.awsSecretAccessKey,
  });
  const listed = listDeployments({ exec, env, region: SMOOTH_REGION });
  if (!listed.ok) {
    io.err(listed.error);
    return 1;
  }
  io.write(formatDeployments(listed.stacks, { region: SMOOTH_REGION, colors: io.c }));
  io.write("");
  return 0;
}

export async function runDestroy(opts, ctx) {
  const io = writers(ctx);
  const exec = ctx.exec ?? createExec(ctx.env);
  const homeDir = ctx.homeDir ?? homedir();

  if (opts.dryRun) {
    io.dim("dry-run — destroy nothing");
    io.write("");
  }

  let space = null;
  let stackName = "";
  try {
    const target = opts.space || opts.stackName;
    if (target) {
      space = findSpaceByTarget(target, { homeDir, cwd: ctx.cwd });
      stackName = space?.stackName || target;
    } else {
      space = await resolveSelectedSpace(opts, { ...ctx, homeDir });
      stackName = space.stackName;
    }
  } catch (error) {
    if (error && error.code === "USAGE") {
      io.err(error.message);
      return 1;
    }
    throw error;
  }

  if (!stackName) {
    io.err(`destroy needs a space name from \`${LIST_CLI}\`.`);
    io.write(`Next: ${LIST_CLI}`);
    return 1;
  }

  const env = withAwsAuth(ctx.env ?? {}, {
    profile: opts.awsProfile || space?.awsProfile,
    accessKeyId: opts.awsAccessKeyId || space?.values?.AWS_ACCESS_KEY_ID,
    secretAccessKey: opts.awsSecretAccessKey || space?.values?.AWS_SECRET_ACCESS_KEY,
  });
  const listed = listDeployments({
    exec,
    env,
    region: space?.region || SMOOTH_REGION,
  });
  if (!listed.ok) {
    io.err(listed.error);
    return 1;
  }

  if (space) {
    io.write(
      formatSpaces(
        [
          {
            name: space.name,
            stackName: space.stackName,
            status:
              listed.stacks.find((stack) => stack.StackName === space.stackName)
                ?.StackStatus || "",
            updated: "",
          },
        ],
        { colors: io.c }
      )
    );
  } else {
    io.write(formatDeployments(listed.stacks, { region: SMOOTH_REGION, colors: io.c }));
  }
  io.write("");

  const known = listed.stacks.some((stack) => stack.StackName === stackName);
  if (!known) {
    io.err(`unknown space ${opts.space || stackName}. Use a name from \`${LIST_CLI}\`.`);
    return 1;
  }

  if (opts.dryRun) {
    io.write(`Would destroy ${space?.name || stackName}`);
    io.write(`Next: ${DESTROY_CLI} ${space?.name || stackName} --yes`);
    return 0;
  }

  const tty = Boolean(ctx.stdin && ctx.stdin.isTTY && ctx.stdout && ctx.stdout.isTTY);
  if (!opts.yes) {
    if (!tty) {
      io.err("not a TTY. Re-run with --yes to destroy.");
      return 1;
    }
    const confirm = ctx.confirmDestroy ?? confirmDestroyPrompt;
    const ok = await confirm(space?.name || stackName);
    if (!ok) {
      io.write("Cancelled.");
      return 1;
    }
  }

  io.warn(
    "Non-default brains are not in CloudFormation — delete them from /brains first."
  );

  const readyStack = await ensureStackRoot({
    stackRoot: ctx.stackRoot,
    env: ctx.env ?? {},
    homeDir,
    cwd: ctx.cwd,
    fetchStack: ctx.fetchStack,
    version: ctx.cliVersion,
    packageDir: ctx.packageDir,
  });
  if (!readyStack.ok) {
    io.err(readyStack.error);
    return 1;
  }

  const progress = createProgress({
    stdout: ctx.stdout,
    env: ctx.env,
    verbose: opts.verbose,
  });
  if (opts.verbose) io.write(`Destroying ${space?.name || stackName}…`);
  else if (!ctx.stdout?.isTTY) io.write(LABEL_DESTROYING);
  else progress.start(LABEL_DESTROYING);
  return (ctx.runDeploy ?? runCdk)({
    repoRoot: readyStack.stackRoot,
    stackRoot: readyStack.stackRoot,
    action: "destroy",
    stackName,
    namePrefix: space?.namePrefix,
    env,
    home: opts.home,
    envFile: opts.envFile || space?.envPath,
    cwd: ctx.cwd,
    exec,
    io,
    verbose: opts.verbose,
    progress,
    homeDir,
    version: ctx.cliVersion,
    packageDir: ctx.packageDir,
  });
}

async function confirmDestroyPrompt(stackName) {
  const { confirm } = await import("@inquirer/prompts");
  return confirm({
    message: `Destroy ${stackName}? This cannot be undone.`,
    default: false,
  });
}

function withAwsAuth(env, { profile, accessKeyId, secretAccessKey } = {}) {
  const next = { ...env };
  if (profile) next.AWS_PROFILE = profile;
  if (accessKeyId) next.AWS_ACCESS_KEY_ID = accessKeyId;
  if (secretAccessKey) next.AWS_SECRET_ACCESS_KEY = secretAccessKey;
  return next;
}
