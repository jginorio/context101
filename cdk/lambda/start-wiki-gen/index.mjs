/**
 * start-wiki-gen Lambda
 *
 * Why this exists: Amplify Hosting's SSR compute role gets a platform
 * session policy applied that explicitly denies iam:PassRole, so the
 * SSR function can't call ecs:RunTask directly. This dispatcher Lambda
 * has its own role (no session-policy deny) and can pass the ECS roles
 * cleanly. The SSR /api/wiki/refresh route invokes this fn.
 *
 * Event payload modes:
 *   • {} or { mode: "main" }                — main team wiki (default).
 *   • { mode: "code", repo: "owner/repo" }  — per-repo code wiki, scoped
 *                                             to sources/github/<repo-slug>/
 *                                             → wiki/code/<repo-slug>/.
 *   • { force: true }                       — sets WIKI_FORCE=1 on the
 *                                             container env so generate.py
 *                                             bypasses its no-change guard.
 *                                             Used by the manual "Refresh
 *                                             now" button. The EventBridge
 *                                             schedule never sets force, so
 *                                             scheduled ticks become
 *                                             near-no-ops when nothing
 *                                             changed.
 *   • { checkOnly: true }                   — don't start a task; just
 *                                             return whether one is
 *                                             already running for the
 *                                             requested (mode, repo).
 *                                             The frontend uses this on
 *                                             page-mount so any user
 *                                             landing on /wiki sees the
 *                                             same in-flight regen.
 *
 * Single-flight: every invocation that *would* start a task first
 * inspects the cluster for a matching running/pending task (same
 * task-def family, same WIKI_MODE, same REPO_FULL_NAME for code mode).
 * If found, the existing taskArn is returned with alreadyRunning=true
 * instead of starting a duplicate. Source of truth is ECS itself —
 * no separate lock store, so a crashed task self-heals (it just stops
 * appearing in ListTasks).
 *
 * Same Fargate task definition handles both modes; we override env
 * vars via containerOverrides at RunTask time.
 */
import {
  ECSClient,
  RunTaskCommand,
  ListTasksCommand,
  DescribeTasksCommand,
} from "@aws-sdk/client-ecs";

const ecs = new ECSClient({});

function slugify(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Strip the trailing :revision off a task-definition ARN so we can match
 * any revision of the same family (CDK bumps the revision on container
 * image / env changes).
 */
function taskDefFamilyArn(arn) {
  return (arn || "").replace(/:\d+$/, "");
}

/**
 * Inspect a single task's container env overrides. Returns the WIKI_MODE
 * and REPO_FULL_NAME the task was launched with, defaulting WIKI_MODE to
 * "main" when no override was supplied (matches the EventBridge schedule
 * target, which sets no overrides).
 */
function readTaskModeRepo(task) {
  const env = task?.overrides?.containerOverrides?.[0]?.environment ?? [];
  const find = (name) => env.find((e) => e.name === name)?.value;
  return {
    mode: find("WIKI_MODE") ?? "main",
    repo: find("REPO_FULL_NAME") ?? null,
  };
}

/**
 * Find an existing running/pending task that matches (mode, repo).
 *
 * desiredStatus="RUNNING" returns tasks whose *desired* status is RUNNING,
 * which includes ones whose *last* status is still PROVISIONING/PENDING.
 * That's exactly what we want: a task that just got dispatched but isn't
 * fully up yet still counts as a regen in flight.
 */
async function findRunningTask(cluster, taskDefArn, { mode, repo }) {
  const listed = await ecs.send(
    new ListTasksCommand({ cluster, desiredStatus: "RUNNING" })
  );
  const arns = listed.taskArns ?? [];
  if (arns.length === 0) return null;

  const familyPrefix = taskDefFamilyArn(taskDefArn);
  const matches = [];
  for (let i = 0; i < arns.length; i += 100) {
    const desc = await ecs.send(
      new DescribeTasksCommand({ cluster, tasks: arns.slice(i, i + 100) })
    );
    for (const t of desc.tasks ?? []) {
      if (!t.taskDefinitionArn?.startsWith(familyPrefix + ":")) continue;
      if (t.lastStatus === "STOPPED") continue;
      const m = readTaskModeRepo(t);
      if (m.mode !== mode) continue;
      if (mode === "code" && m.repo !== repo) continue;
      matches.push(t);
    }
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const ta = a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const tb = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    return tb - ta;
  });
  const t = matches[0];
  return { taskArn: t.taskArn, lastStatus: t.lastStatus };
}

export const handler = async (event = {}) => {
  const cluster = process.env.WIKI_CLUSTER_ARN;
  const taskDef = process.env.WIKI_TASK_DEF_ARN;
  const subnetIds = (process.env.WIKI_SUBNET_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const securityGroup = process.env.WIKI_SECURITY_GROUP_ID;

  if (!cluster || !taskDef || subnetIds.length === 0 || !securityGroup) {
    throw new Error("Wiki generator env vars missing on Lambda");
  }

  const mode = event.mode === "code" ? "code" : "main";
  let repo = null;
  if (mode === "code") {
    repo = event.repo;
    if (!repo || !repo.includes("/")) {
      throw new Error(
        'code mode requires { repo: "owner/repo" } in the event payload'
      );
    }
  }

  const existing = await findRunningTask(cluster, taskDef, { mode, repo });

  if (event.checkOnly) {
    return existing
      ? {
          running: true,
          taskArn: existing.taskArn,
          lastStatus: existing.lastStatus,
          mode,
          repo,
        }
      : { running: false, mode, repo };
  }

  if (existing) {
    return {
      statusCode: 200,
      mode,
      repo,
      taskArn: existing.taskArn,
      lastStatus: existing.lastStatus,
      alreadyRunning: true,
    };
  }

  const overrideEnv = [{ name: "WIKI_MODE", value: mode }];
  if (mode === "code") {
    const [owner, name] = repo.split("/");
    const repoSlug = slugify(`${owner}-${name}`);
    overrideEnv.push(
      { name: "REPO_FULL_NAME", value: repo },
      { name: "CORPUS_PREFIX", value: `sources/github/${repoSlug}/` },
      { name: "WIKI_PREFIX", value: `wiki/code/${repoSlug}/` }
    );
  }
  if (event.force === true) {
    overrideEnv.push({ name: "WIKI_FORCE", value: "1" });
  }

  // The container in our task def is named "generator" (CDK:
  // wikiTaskDef.addContainer("generator", …)). containerOverrides.name
  // MUST match for the env-var overrides to apply.
  const res = await ecs.send(
    new RunTaskCommand({
      cluster,
      taskDefinition: taskDef,
      launchType: "FARGATE",
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: subnetIds,
          securityGroups: [securityGroup],
          assignPublicIp: "ENABLED",
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: "generator",
            environment: overrideEnv,
          },
        ],
      },
    })
  );

  const task = res.tasks?.[0];
  return {
    statusCode: 200,
    mode,
    repo,
    forced: event.force === true,
    taskArn: task?.taskArn,
    lastStatus: task?.lastStatus,
    alreadyRunning: false,
  };
};
