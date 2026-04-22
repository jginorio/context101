import {
  ECSClient,
  RunTaskCommand,
  DescribeTasksCommand,
} from "@aws-sdk/client-ecs";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ecs = new ECSClient({ region: process.env.AWS_REGION ?? "us-east-1" });

const CLUSTER = process.env.WIKI_CLUSTER_ARN;
const TASK_DEF = process.env.WIKI_TASK_DEF_ARN;
const SUBNET_IDS = (process.env.WIKI_SUBNET_IDS ?? "")
  .split(",")
  .filter(Boolean);
const SECURITY_GROUP = process.env.WIKI_SECURITY_GROUP_ID;

/**
 * POST /api/wiki/refresh
 *
 * Triggers a one-off run of the wiki-generator Fargate task. Returns the
 * task ARN so the UI can poll /api/wiki/status until it finishes.
 *
 * The cluster/task-def/subnet/SG IDs are baked into the Amplify app's
 * environment variables by CDK.
 */
export async function POST() {
  if (!CLUSTER || !TASK_DEF || SUBNET_IDS.length === 0 || !SECURITY_GROUP) {
    return NextResponse.json(
      { error: "Wiki generator env vars not configured — run cdk deploy" },
      { status: 500 }
    );
  }

  try {
    const res = await ecs.send(
      new RunTaskCommand({
        cluster: CLUSTER,
        taskDefinition: TASK_DEF,
        launchType: "FARGATE",
        count: 1,
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: SUBNET_IDS,
            securityGroups: [SECURITY_GROUP],
            assignPublicIp: "ENABLED",
          },
        },
        startedBy: "context101-web-refresh",
      })
    );

    const taskArn = res.tasks?.[0]?.taskArn;
    const failure = res.failures?.[0];
    if (!taskArn) {
      return NextResponse.json(
        { error: failure?.reason ?? "RunTask returned no task" },
        { status: 500 }
      );
    }

    return NextResponse.json({ taskArn });
  } catch (err) {
    console.error("wiki refresh failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/wiki/refresh?taskArn=<arn>
 *
 * Polls a running task. Returns lastStatus ("PROVISIONING" | "PENDING" |
 * "RUNNING" | "DEACTIVATING" | "STOPPING" | "STOPPED") and, once stopped,
 * the stopReason + container exit code.
 */
export async function GET(request: NextRequest) {
  if (!CLUSTER) {
    return NextResponse.json(
      { error: "WIKI_CLUSTER_ARN not configured" },
      { status: 500 }
    );
  }
  const taskArn = request.nextUrl.searchParams.get("taskArn");
  if (!taskArn) {
    return NextResponse.json({ error: "taskArn is required" }, { status: 400 });
  }

  try {
    const res = await ecs.send(
      new DescribeTasksCommand({
        cluster: CLUSTER,
        tasks: [taskArn],
      })
    );
    const task = res.tasks?.[0];
    if (!task) {
      return NextResponse.json({ error: "task not found" }, { status: 404 });
    }
    return NextResponse.json({
      lastStatus: task.lastStatus ?? null,
      stopCode: task.stopCode ?? null,
      stoppedReason: task.stoppedReason ?? null,
      exitCode: task.containers?.[0]?.exitCode ?? null,
    });
  } catch (err) {
    console.error("wiki status failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
