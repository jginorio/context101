/**
 * start-wiki-gen Lambda
 *
 * Why this exists: Amplify Hosting's SSR compute role gets a platform
 * session policy applied that explicitly denies iam:PassRole, so the
 * SSR function can't call ecs:RunTask directly. This dispatcher Lambda
 * has its own role (no session-policy deny) and can pass the ECS roles
 * cleanly. The SSR /api/wiki/refresh route invokes this fn.
 *
 * Modes (selected via the invoke event payload):
 *   • {} or { mode: "main" } — main team wiki (default).
 *   • { mode: "code", repo: "owner/repo" } — per-repo code wiki, scoped
 *     to sources/github/<repo-slug>/ → wiki/code/<repo-slug>/.
 *
 * The same Fargate task definition handles both modes; we just override
 * env vars via containerOverrides at RunTask time.
 */
import { ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";

const ecs = new ECSClient({});

function slugify(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
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

  // Build env overrides per mode. The container's WIKI_MODE drives prompts
  // + corpus/output prefix selection inside generate.py.
  const overrideEnv = [{ name: "WIKI_MODE", value: mode }];
  if (mode === "code") {
    const repo = event.repo;
    if (!repo || !repo.includes("/")) {
      throw new Error(
        'code mode requires { repo: "owner/repo" } in the event payload'
      );
    }
    const [owner, name] = repo.split("/");
    const repoSlug = slugify(`${owner}-${name}`);
    overrideEnv.push(
      { name: "REPO_FULL_NAME", value: repo },
      { name: "CORPUS_PREFIX", value: `sources/github/${repoSlug}/` },
      { name: "WIKI_PREFIX", value: `wiki/code/${repoSlug}/` }
    );
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
    repo: event.repo,
    taskArn: task?.taskArn,
    lastStatus: task?.lastStatus,
  };
};
