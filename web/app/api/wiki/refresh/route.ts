import {
  ECSClient,
  DescribeTasksCommand,
} from "@aws-sdk/client-ecs";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ecs = new ECSClient({ region: process.env.AWS_REGION ?? "us-east-1" });
const lambdaClient = new LambdaClient({
  region: process.env.AWS_REGION ?? "us-east-1",
});

const CLUSTER = process.env.WIKI_CLUSTER_ARN;
const START_FN = process.env.START_WIKI_GEN_FN_NAME;

/**
 * POST /api/wiki/refresh
 *
 * Invokes a dispatcher Lambda (start-wiki-gen) that does the ECS RunTask.
 *
 * Why not call RunTask directly from here? Amplify Hosting's SSR compute
 * role gets a platform session policy that explicitly denies iam:PassRole,
 * and RunTask needs PassRole on the task + execution roles. The dispatcher
 * Lambda has its own role without that deny.
 */
export async function POST() {
  if (!START_FN) {
    return NextResponse.json(
      { error: "START_WIKI_GEN_FN_NAME env var not set — run cdk deploy" },
      { status: 500 }
    );
  }

  try {
    const res = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: START_FN,
        InvocationType: "RequestResponse",
        Payload: new Uint8Array(), // no args needed
      })
    );

    if (res.FunctionError) {
      const payload = res.Payload
        ? new TextDecoder().decode(res.Payload)
        : "";
      return NextResponse.json(
        { error: `Lambda error: ${payload}` },
        { status: 500 }
      );
    }

    const text = res.Payload ? new TextDecoder().decode(res.Payload) : "{}";
    const parsed = JSON.parse(text) as {
      taskArn?: string;
      lastStatus?: string;
    };
    if (!parsed.taskArn) {
      return NextResponse.json(
        { error: "dispatcher returned no taskArn", detail: text },
        { status: 500 }
      );
    }

    return NextResponse.json({ taskArn: parsed.taskArn });
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
