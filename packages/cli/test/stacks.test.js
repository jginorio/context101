import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { STACK_NAME } from "../src/defaults.js";
import { main } from "../src/main.js";
import {
  formatDeployments,
  isContext101Deployment,
  parseStackSummaries,
} from "../src/stacks.js";
import { fakeExec, makeRepoFixture, memoryIo, testEnv } from "./helpers.js";

function listStacksPayload(summaries) {
  return {
    ok: true,
    code: 0,
    stdout: JSON.stringify({ StackSummaries: summaries }),
    stderr: "",
    error: null,
  };
}

const LIVE = {
  StackName: STACK_NAME,
  StackStatus: "CREATE_COMPLETE",
  LastUpdatedTime: "2026-09-12T20:00:00+00:00",
  TemplateDescription: "Context101 self-host",
};

test("isContext101Deployment keeps root stacks and drops nested, deleted, and unrelated", () => {
  assert.equal(isContext101Deployment(LIVE), true);
  assert.equal(
    isContext101Deployment({
      StackName: "Context101Stack-WikiNested-ABC",
      StackStatus: "CREATE_COMPLETE",
      ParentId: "arn:aws:cloudformation:xx-test-1:123:stack/Context101Stack/id",
    }),
    false
  );
  assert.equal(
    isContext101Deployment({
      ...LIVE,
      StackStatus: "DELETE_COMPLETE",
    }),
    false
  );
  assert.equal(
    isContext101Deployment({
      StackName: "CDKToolkit",
      StackStatus: "CREATE_COMPLETE",
      TemplateDescription: "The CDK Toolkit Stack",
    }),
    false
  );
});

test("formatDeployments prints an empty next-step and a table", () => {
  assert.match(formatDeployments([], { region: "xx-test-1" }), /No Context101 deployments/);
  assert.match(formatDeployments([], { region: "xx-test-1" }), /npx context101 deploy/);
  const table = formatDeployments([LIVE], { region: "xx-test-1" });
  assert.match(table, /Context101Stack/);
  assert.match(table, /CREATE_COMPLETE/);
  assert.match(table, /2026-09-12T20:00:00/);
});

test("parseStackSummaries tolerates a missing list", () => {
  assert.deepEqual(parseStackSummaries({}), []);
  assert.deepEqual(parseStackSummaries(null), []);
});

test("context101 list prints no deployments when the account is empty", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-ls-empty-"));
  await makeRepoFixture(root);
  const io = memoryIo();

  const code = await main(["list"], {
    cwd: root,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(),
  });

  assert.equal(code, 0);
  assert.match(io.stdoutText, /No Context101 deployments/);
  assert.match(io.stdoutText, /npx context101 deploy/);
  assert.equal(io.stdoutText.includes("deploy.sh"), false);
});

test("context101 list prints Context101 stacks and ignores nested and toolkit", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-ls-"));
  await makeRepoFixture(root);
  const io = memoryIo();

  const code = await main(["ls", "--aws-profile", "findit"], {
    cwd: root,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec({
      listStacks: listStacksPayload([
        LIVE,
        {
          StackName: "Context101Stack-Nested-XYZ",
          StackStatus: "CREATE_COMPLETE",
          ParentId: "arn:aws:cloudformation:xx-test-1:123:stack/Context101Stack/id",
        },
        {
          StackName: "CDKToolkit",
          StackStatus: "CREATE_COMPLETE",
          TemplateDescription: "The CDK Toolkit Stack",
        },
        {
          StackName: "Context101Stack",
          StackStatus: "DELETE_COMPLETE",
        },
      ]),
    }),
  });

  assert.equal(code, 0);
  assert.match(io.stdoutText, /Context101Stack/);
  assert.match(io.stdoutText, /CREATE_COMPLETE/);
  assert.equal(io.stdoutText.includes("Nested-XYZ"), false);
  assert.equal(io.stdoutText.includes("CDKToolkit"), false);
  assert.equal(io.stdoutText.includes("DELETE_COMPLETE"), false);
});

test("context101 destroy --dry-run does not call the wrapper", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-rm-dry-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const calls = [];

  const code = await main(["destroy", "--dry-run"], {
    cwd: root,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec({ listStacks: listStacksPayload([LIVE]) }),
    runDeploy: async (spec) => {
      calls.push(spec);
      return 0;
    },
  });

  assert.equal(code, 0);
  assert.equal(calls.length, 0);
  assert.match(io.stdoutText, /Would destroy Context101Stack/);
  assert.match(io.stdoutText, /npx context101 destroy --yes/);
  assert.equal(io.stdoutText.includes("deploy.sh"), false);
  assert.equal(io.stdoutText.includes("cdk destroy"), false);
});

test("context101 destroy --dry-run on an empty account does not invent a stack", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-rm-empty-"));
  await makeRepoFixture(root);
  const io = memoryIo();

  const code = await main(["destroy", "--dry-run"], {
    cwd: root,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(),
  });

  assert.equal(code, 0);
  assert.match(io.stdoutText, /No Context101 deployments/);
  assert.equal(io.stdoutText.includes("Would destroy"), false);
});

test("context101 destroy without --yes on a non-TTY refuses", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-rm-tty-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const calls = [];

  const code = await main(["remove"], {
    cwd: root,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec({ listStacks: listStacksPayload([LIVE]) }),
    runDeploy: async (spec) => {
      calls.push(spec);
      return 0;
    },
  });

  assert.equal(code, 1);
  assert.equal(calls.length, 0);
  assert.match(io.stderrText, /not a TTY/);
  assert.match(io.stderrText, /--yes/);
});

test("context101 destroy --yes calls the wrapper with destroy --force", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-rm-yes-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const calls = [];

  const code = await main(["destroy", "--yes"], {
    cwd: root,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec({ listStacks: listStacksPayload([LIVE]) }),
    runDeploy: async (spec) => {
      calls.push(spec);
      return 0;
    },
  });

  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].repoRoot, root);
  assert.equal(calls[0].action, "destroy");
  assert.deepEqual(calls[0].extraArgs, ["--force"]);
  assert.match(io.stdoutText, /Destroying Context101Stack/);
  assert.match(`${io.stdoutText}\n${io.stderrText}`, /not in CloudFormation/);
  assert.equal(io.stdoutText.includes("deploy.sh"), false);
});

test("context101 destroy confirms on a TTY and cancels when declined", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-rm-no-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  io.stdout.isTTY = true;
  io.stdin.isTTY = true;
  const calls = [];

  const code = await main(["rm"], {
    cwd: root,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec({ listStacks: listStacksPayload([LIVE]) }),
    confirmDestroy: async () => false,
    runDeploy: async (spec) => {
      calls.push(spec);
      return 0;
    },
  });

  assert.equal(code, 1);
  assert.equal(calls.length, 0);
  assert.match(io.stdoutText, /Cancelled/);
});
