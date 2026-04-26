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

type LambdaResult = {
  taskArn?: string;
  lastStatus?: string;
  alreadyRunning?: boolean;
  running?: boolean;
  forced?: boolean;
};

async function invokeStartWikiGen(
  payload: Record<string, unknown>
): Promise<LambdaResult> {
  if (!START_FN) {
    throw new Error("START_WIKI_GEN_FN_NAME env var not set — run cdk deploy");
  }
  const res = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: START_FN,
      InvocationType: "RequestResponse",
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    })
  );
  const text = res.Payload ? new TextDecoder().decode(res.Payload) : "{}";
  if (res.FunctionError) {
    throw new Error(`Lambda error: ${text}`);
  }
  return JSON.parse(text) as LambdaResult;
}

/**
 * POST /api/wiki/refresh
 *
 * Manual "Refresh now" button. Forwards { force: true } to the dispatcher
 * Lambda so generate.py bypasses its no-change corpus-hash guard — when a
 * human asks for a regen they get one. The Lambda also single-flights:
 * if a regen is already in flight for the same mode, it returns that
 * task's arn with alreadyRunning=true and we attach to it.
 *
 * Why not call RunTask directly from here? Amplify Hosting's SSR compute
 * role gets a platform session policy that explicitly denies iam:PassRole,
 * and RunTask needs PassRole on the task + execution roles. The dispatcher
 * Lambda has its own role without that deny.
 */
export async function POST() {
  try {
    const parsed = await invokeStartWikiGen({ force: true });
    if (!parsed.taskArn) {
      return NextResponse.json(
        { error: "dispatcher returned no taskArn", detail: parsed },
        { status: 500 }
      );
    }
    return NextResponse.json({
      taskArn: parsed.taskArn,
      alreadyRunning: parsed.alreadyRunning ?? false,
    });
  } catch (err) {
    console.error("wiki refresh failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/wiki/refresh
 *
 *   • ?check=1                 — ask the dispatcher whether a main-mode
 *                                regen is currently running. Used on
 *                                /wiki page-mount so any user (refresh,
 *                                another browser, another teammate) sees
 *                                the same in-flight regen and converges
 *                                on the same taskArn for polling.
 *                                Returns { running: boolean, taskArn? }.
 *
 *   • ?taskArn=<arn>           — poll a known task. Returns lastStatus
 *                                ("PROVISIONING" | "PENDING" | "RUNNING"
 *                                | "DEACTIVATING" | "STOPPING" |
 *                                "STOPPED") and, once stopped, stopReason
 *                                + container exit code.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  if (params.get("check") === "1") {
    try {
      const parsed = await invokeStartWikiGen({ checkOnly: true });
      return NextResponse.json({
        running: parsed.running ?? false,
        taskArn: parsed.taskArn ?? null,
      });
    } catch (err) {
      console.error("wiki check failed:", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 500 }
      );
    }
  }

  if (!CLUSTER) {
    return NextResponse.json(
      { error: "WIKI_CLUSTER_ARN not configured" },
      { status: 500 }
    );
  }
  const taskArn = params.get("taskArn");
  if (!taskArn) {
    return NextResponse.json(
      { error: "taskArn or check=1 is required" },
      { status: 400 }
    );
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
