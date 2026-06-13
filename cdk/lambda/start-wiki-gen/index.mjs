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
 *                                             now" button.
 *   • { checkOnly: true }                   — don't start a task; just
 *                                             return whether one is
 *                                             already running for the
 *                                             requested (brain_id, mode,
 *                                             repo).
 *   • { brain_id: <id> }                    — multi-brain: scope the run
 *                                             to the brain's docs bucket.
 *                                             Resolved from BrainsTable;
 *                                             defaults to "default".
 *
 * Single-flight: every invocation that *would* start a task first
 * inspects the cluster for a matching running/pending task (same
 * task-def family, same BRAIN_ID, same WIKI_MODE, same REPO_FULL_NAME
 * for code mode). If found, the existing taskArn is returned with
 * alreadyRunning=true. Source of truth is ECS — a crashed task self-heals.
 *
 * Same Fargate task definition handles every brain + every mode; we
 * override DOCS_BUCKET / BRAIN_ID / WIKI_MODE / CORPUS_PREFIX / WIKI_PREFIX
 * / REPO_FULL_NAME / WIKI_FORCE via containerOverrides at RunTask time.
 */
import { createRequire } from "node:module";
import {
  ECSClient,
  RunTaskCommand,
  ListTasksCommand,
  DescribeTasksCommand,
} from "@aws-sdk/client-ecs";

// pg-http ships as a Lambda layer (zero-dependency Neon-over-HTTP helper).
const require = createRequire(import.meta.url);
const { pgFetchOne } = require("pg-http");

const ecs = new ECSClient({});

const DATABASE_URL = process.env.DATABASE_URL;

function slugify(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function taskDefFamilyArn(arn) {
  return (arn || "").replace(/:\d+$/, "");
}

function readTaskEnv(task, name) {
  const env = task?.overrides?.containerOverrides?.[0]?.environment ?? [];
  return env.find((e) => e.name === name)?.value;
}

function readTaskKey(task) {
  return {
    brainId: readTaskEnv(task, "BRAIN_ID") ?? "default",
    mode: readTaskEnv(task, "WIKI_MODE") ?? "main",
    repo: readTaskEnv(task, "REPO_FULL_NAME") ?? null,
  };
}

async function findRunningTask(cluster, taskDefArn, { brainId, mode, repo }) {
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
      const k = readTaskKey(t);
      if (k.brainId !== brainId) continue;
      if (k.mode !== mode) continue;
      if (mode === "code" && k.repo !== repo) continue;
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

async function resolveBrain(brainId) {
  if (!DATABASE_URL) throw new Error("DATABASE_URL env var missing");
  const item = await pgFetchOne(
    DATABASE_URL,
    `select id, status, docs_bucket,
            wiki_model_provider, wiki_model_id, wiki_llm_key_secret_arn
       from brains where id = $1`,
    [brainId]
  );
  if (!item) throw new Error(`brain not found: ${brainId}`);
  if (item.status !== "ready") {
    throw new Error(`brain ${brainId} is ${item.status}, not ready`);
  }
  if (!item.docs_bucket) {
    throw new Error(`brain ${brainId} has no docs_bucket`);
  }
  return item;
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

  const brainId = event.brain_id || "default";
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

  const existing = await findRunningTask(cluster, taskDef, {
    brainId,
    mode,
    repo,
  });

  if (event.checkOnly) {
    return existing
      ? {
          running: true,
          taskArn: existing.taskArn,
          lastStatus: existing.lastStatus,
          brainId,
          mode,
          repo,
        }
      : { running: false, brainId, mode, repo };
  }

  if (existing) {
    return {
      statusCode: 200,
      brainId,
      mode,
      repo,
      taskArn: existing.taskArn,
      lastStatus: existing.lastStatus,
      alreadyRunning: true,
    };
  }

  // Resolve brain → docs bucket for the container env. Done after the
  // dedup check so a still-provisioning brain can be polled via checkOnly
  // without throwing.
  const brain = await resolveBrain(brainId);

  const overrideEnv = [
    { name: "BRAIN_ID", value: brainId },
    { name: "DOCS_BUCKET", value: brain.docs_bucket },
    { name: "WIKI_MODE", value: mode },
  ];
  // Per-brain wiki model. Null provider → the generator's default Bedrock
  // path. For bring-your-own providers, pass the provider + model + the
  // Secrets Manager ARN holding the API key (the task fetches it at runtime;
  // the raw key never lands in the task env / DescribeTasks output). For the
  // subscription CLI-agent providers (claude-code, codex) the secret holds an
  // OAuth subscription token instead of an API key.
  const isCliAgent =
    brain.wiki_model_provider === "claude-code" ||
    brain.wiki_model_provider === "codex";
  if (brain.wiki_model_provider) {
    overrideEnv.push({ name: "MODEL_PROVIDER", value: brain.wiki_model_provider });
  }
  if (brain.wiki_model_id) {
    // CLI agents read the model override from HARNESS_MODEL; MODEL_ID is a
    // Bedrock-shaped id they ignore.
    overrideEnv.push({
      name: isCliAgent ? "HARNESS_MODEL" : "MODEL_ID",
      value: brain.wiki_model_id,
    });
  }
  if (brain.wiki_llm_key_secret_arn) {
    overrideEnv.push({
      name: "LLM_KEY_SECRET_ARN",
      value: brain.wiki_llm_key_secret_arn,
    });
  }
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
    brainId,
    mode,
    repo,
    forced: event.force === true,
    taskArn: task?.taskArn,
    lastStatus: task?.lastStatus,
    alreadyRunning: false,
  };
};
