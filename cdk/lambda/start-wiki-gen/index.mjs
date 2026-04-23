/**
 * start-wiki-gen Lambda
 *
 * Why this exists: Amplify Hosting's SSR compute role gets a platform
 * session policy applied that explicitly denies iam:PassRole, so the
 * SSR function can't call ecs:RunTask directly. This small dispatcher
 * Lambda has its own role (no session-policy deny) and can pass the
 * ECS roles cleanly. The SSR /api/wiki/refresh route invokes this fn.
 */
import {
  ECSClient,
  RunTaskCommand,
} from "@aws-sdk/client-ecs";

const ecs = new ECSClient({});

export const handler = async () => {
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
    })
  );

  const task = res.tasks?.[0];
  return {
    statusCode: 200,
    taskArn: task?.taskArn,
    lastStatus: task?.lastStatus,
  };
};
