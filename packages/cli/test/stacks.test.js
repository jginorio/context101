import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { STACK_NAME } from "../src/defaults.js";
import { main } from "./run-main.js";
import {
  formatDeployments,
  isContext101Deployment,
  parseStackSummaries,
  statusTone,
} from "../src/stacks.js";
import { monorepoStackRoot } from "../src/stack-source.js";
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
  assert.match(formatDeployments([], { region: "xx-test-1" }), /No Context101 spaces/);
  assert.match(formatDeployments([], { region: "xx-test-1" }), /context101 init/);
  const table = formatDeployments([LIVE], { region: "xx-test-1" });
  assert.match(table, /Context101Stack/);
  assert.match(table, /CREATE_COMPLETE/);
  assert.match(table, /2026-09-12T20:00:00/);
  assert.match(table, /NAME/);
  assert.match(table, /STATUS/);
  assert.match(table, /UPDATED/);
  assert.equal(table.includes("│"), false);
  assert.equal(table.includes("┌"), false);
});

test("statusTone is brand for complete, violet for in-flight, red for failed", () => {
  const colors = { magenta: "M", violet: "V", red: "R" };
  assert.equal(statusTone("UPDATE_COMPLETE", colors), "M");
  assert.equal(statusTone("CREATE_COMPLETE", colors), "M");
  assert.equal(statusTone("UPDATE_IN_PROGRESS", colors), "V");
  assert.equal(statusTone("UPDATE_COMPLETE_CLEANUP_IN_PROGRESS", colors), "V");
  assert.equal(statusTone("CREATE_FAILED", colors), "R");
  assert.equal(statusTone("UPDATE_ROLLBACK_COMPLETE", colors), "R");
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
  assert.match(io.stdoutText, /No Context101 spaces/);
  assert.match(io.stdoutText, /context101 init/);
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

test("context101 list works without a checkout", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-ls-norepo-"));
  const io = memoryIo();

  const code = await main(["list", "--aws-profile", "plateapr.com"], {
    cwd,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec({
      listStacks: listStacksPayload([
        {
          ...LIVE,
          StackStatus: "UPDATE_COMPLETE",
        },
      ]),
    }),
  });

  assert.equal(code, 0);
  assert.match(io.stdoutText, /your context\. every agent\./);
  assert.match(io.stdoutText, /Context101Stack/);
  assert.match(io.stdoutText, /UPDATE_COMPLETE/);
  assert.match(io.stdoutText, /2026-09-12T20:00:00/);
  assert.equal(io.stdoutText.includes("self-host setup"), false);
  assert.equal(io.stdoutText.includes("deploy.sh"), false);
  assert.equal(io.stdoutText.includes("site/"), false);
  assert.equal(io.stderrText.includes("checkout"), false);
});

test("context101 destroy without a name refuses", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-rm-noname-"));
  await makeRepoFixture(root);
  const io = memoryIo();

  const code = await main(["destroy", "--dry-run"], {
    cwd: root,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec({ listStacks: listStacksPayload([LIVE]) }),
  });

  assert.equal(code, 1);
  assert.match(io.stderrText, /needs a space name|no spaces yet/);
  assert.equal(io.stdoutText.includes("Would destroy"), false);
});

test("context101 destroy --dry-run does not call cdk", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-rm-dry-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const calls = [];

  const code = await main(["destroy", "Context101Stack", "--dry-run"], {
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
  assert.match(io.stdoutText, /Would destroy (default|Context101Stack)/);
  assert.match(io.stdoutText, /context101 destroy (default|Context101Stack) --yes/);
  assert.equal(io.stdoutText.includes("deploy.sh"), false);
});

test("context101 destroy refuses a name that is not listed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-rm-unk-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const calls = [];

  const code = await main(["destroy", "OtherStack", "--yes"], {
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
  assert.match(io.stderrText, /unknown space OtherStack/);
});

test("context101 destroy without --yes on a non-TTY refuses", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-rm-tty-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const calls = [];

  const code = await main(["remove", "Context101Stack"], {
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

test("context101 destroy --yes calls cdk destroy with the listed name", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-rm-yes-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const calls = [];

  const code = await main(["destroy", "Context101Stack", "--yes"], {
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
  assert.equal(calls[0].repoRoot, monorepoStackRoot());
  assert.equal(calls[0].action, "destroy");
  assert.equal(calls[0].stackName, "Context101Stack");
  assert.match(io.stdoutText, /destroying/);
  assert.match(`${io.stdoutText}\n${io.stderrText}`, /not in CloudFormation/);
  assert.equal(io.stdoutText.includes("deploy.sh"), false);
});

test("context101 destroy --dry-run works without a checkout", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-rm-norepo-dry-"));
  const io = memoryIo();
  const calls = [];

  const code = await main(["destroy", "Context101Stack", "--dry-run"], {
    cwd,
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
  assert.match(io.stdoutText, /Would destroy (default|Context101Stack)/);
  assert.equal(io.stderrText.includes("checkout"), false);
});

test("context101 destroy --yes uses CLI stack source without a checkout", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-rm-norepo-yes-"));
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-rm-home-"));
  const io = memoryIo();
  const calls = [];

  const code = await main(["destroy", "Context101Stack", "--yes"], {
    cwd,
    homeDir: home,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: (spec) => {
      if (spec.command === "git" && spec.args?.[0] === "clone") {
        throw new Error("should not clone");
      }
      return fakeExec({ listStacks: listStacksPayload([LIVE]) })(spec);
    },
    runDeploy: async (spec) => {
      calls.push(spec);
      return 0;
    },
  });

  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].repoRoot, monorepoStackRoot());
  assert.equal(calls[0].action, "destroy");
  assert.match(io.stdoutText, /destroying/);
  assert.equal(io.stderrText.includes("checkout"), false);
});

test("context101 destroy --yes ignores a leftover checkout in cwd", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-rm-reuse-"));
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-rm-reuse-home-"));
  await makeRepoFixture(cwd);
  const io = memoryIo();
  const calls = [];

  const code = await main(["destroy", "Context101Stack", "--yes"], {
    cwd,
    homeDir: home,
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
  assert.equal(calls[0].repoRoot, monorepoStackRoot());
  assert.notEqual(calls[0].repoRoot, cwd);
  assert.equal(io.stdoutText.includes("Cloning"), false);
});

test("context101 destroy confirms on a TTY and cancels when declined", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-rm-no-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  io.stdout.isTTY = true;
  io.stdin.isTTY = true;
  const calls = [];

  const code = await main(["rm", "Context101Stack"], {
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
