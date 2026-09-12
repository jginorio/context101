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
import { homeSrcDir } from "../src/clone.js";
import { fakeExec, makeRepoFixture, memoryIo, mockCloneCheckout, testEnv } from "./helpers.js";

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
  assert.match(formatDeployments([], { region: "xx-test-1" }), /context101 deploy/);
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
  assert.match(io.stdoutText, /context101 deploy/);
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
  assert.match(io.stdoutText, /Context101Stack/);
  assert.match(io.stdoutText, /UPDATE_COMPLETE/);
  assert.match(io.stdoutText, /2026-09-12T20:00:00/);
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
  assert.match(io.stderrText, /needs a stack name/);
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
  assert.match(io.stdoutText, /Would destroy Context101Stack/);
  assert.match(io.stdoutText, /context101 destroy Context101Stack --yes/);
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
  assert.match(io.stderrText, /unknown stack OtherStack/);
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
  assert.equal(calls[0].repoRoot, root);
  assert.equal(calls[0].action, "destroy");
  assert.equal(calls[0].stackName, "Context101Stack");
  assert.match(io.stdoutText, /Destroying Context101Stack/);
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
  assert.match(io.stdoutText, /Would destroy Context101Stack/);
  assert.equal(io.stderrText.includes("checkout"), false);
});

test("context101 destroy --yes clones into ~/.context101/src without a checkout", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-rm-norepo-yes-"));
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-rm-home-"));
  const io = memoryIo();
  const calls = [];
  let clonedTo = "";

  const code = await main(["destroy", "Context101Stack", "--yes"], {
    cwd,
    homeDir: home,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: (spec) => {
      if (spec.command === "git" && spec.args?.[0] === "clone") {
        clonedTo = spec.args[spec.args.length - 1];
        mockCloneCheckout(clonedTo);
        return { ok: true, code: 0, stdout: "", stderr: "", error: null };
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
  assert.equal(calls[0].repoRoot, homeSrcDir(home));
  assert.equal(calls[0].action, "destroy");
  assert.equal(clonedTo, homeSrcDir(home));
  assert.match(io.stdoutText, /Destroying Context101Stack/);
  assert.equal(io.stderrText.includes("checkout"), false);
});

test("context101 destroy --yes reuses ~/.context101/src", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-rm-reuse-"));
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-rm-reuse-home-"));
  const src = homeSrcDir(home);
  await makeRepoFixture(src);
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
  assert.equal(calls[0].repoRoot, src);
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
