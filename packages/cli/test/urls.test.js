import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "./run-main.js";
import { stackNameForSpace } from "../src/spaces.js";
import {
  describeStackOutputs,
  formatPublicUrls,
  parseStackOutputs,
  pickPublicUrls,
} from "../src/urls.js";
import { fakeExec, memoryIo, testEnv } from "./helpers.js";

const MCP_LAMBDA = "https://d111111abcdef8.cloudfront.net/mcp";
const MCP_LEGACY = "https://abc123.xx-test-1.awsapprunner.com/mcp";
const ADMIN = "https://main.d1234567890.amplifyapp.com";

const SECRET_OUTPUTS = [
  { OutputKey: "DocsBucketName", OutputValue: "context101-docs-secret-bucket" },
  { OutputKey: "KnowledgeBaseId", OutputValue: "KBIDSECRET" },
  { OutputKey: "DataSourceId", OutputValue: "DSIDSECRET" },
  { OutputKey: "VectorBucketArn", OutputValue: "arn:aws:s3:::vector-secret" },
  { OutputKey: "VectorIndexArn", OutputValue: "arn:aws:s3vectors:::index-secret" },
  {
    OutputKey: "ControlPlaneDbSecretArn",
    OutputValue: "arn:aws:secretsmanager:xx-test-1:1:secret:db",
  },
  { OutputKey: "StartWikiGenFnName", OutputValue: "WikiGenFnSecret" },
  { OutputKey: "ConnectorTableName", OutputValue: "ConnectorSecret" },
  {
    OutputKey: "BrainProvisionerRoleArn",
    OutputValue: "arn:aws:iam::1:role/BrainProvisioner",
  },
  { OutputKey: "WebAppId", OutputValue: "dwebappidsecret" },
  {
    OutputKey: "WebSsrComputeRoleArn",
    OutputValue: "arn:aws:iam::1:role/WebSsr",
  },
  { OutputKey: "McpDistributionDomain", OutputValue: "d111111abcdef8.cloudfront.net" },
  { OutputKey: "CTX_TOKEN", OutputValue: "ctx_must_never_appear_token" },
];

function leakyOutputs({ admin = "", mcp = "", mcpLegacy = "" } = {}) {
  const rows = [...SECRET_OUTPUTS];
  if (admin) rows.push({ OutputKey: "WebAppDefaultDomain", OutputValue: admin });
  if (mcp) rows.push({ OutputKey: "McpLambdaUrl", OutputValue: mcp });
  if (mcpLegacy) rows.push({ OutputKey: "McpUrl", OutputValue: mcpLegacy });
  return rows;
}

function describeStacksPayload(outputs, { ok = true, stderr = "" } = {}) {
  if (!ok) {
    return {
      ok: false,
      code: 1,
      stdout: "",
      stderr:
        stderr ||
        "An error occurred (ValidationError) when calling the DescribeStacks operation: Stack with id Context101Testingcontext101 does not exist",
      error: null,
    };
  }
  return {
    ok: true,
    code: 0,
    stdout: JSON.stringify(outputs),
    stderr: "",
    error: null,
  };
}

async function writeNamedSpace(home, name, extra = "") {
  const dir = path.join(home, ".context101", "spaces", name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "deploy-env"),
    [
      'CTX_TOKEN="ctx_testtoken_xx"',
      `STACK_NAME="${stackNameForSpace(name)}"`,
      'AWS_REGION="xx-test-1"',
      extra,
      "",
    ]
      .filter((line) => line !== "")
      .join("\n"),
    { mode: 0o600 }
  );
}

function assertNoSecrets(text) {
  for (const leak of [
    "context101-docs-secret-bucket",
    "KBIDSECRET",
    "DSIDSECRET",
    "vector-secret",
    "index-secret",
    "secretsmanager",
    "WikiGenFnSecret",
    "ConnectorSecret",
    "BrainProvisioner",
    "dwebappidsecret",
    "WebSsr",
    "d111111abcdef8.cloudfront.net\n",
    "ctx_must_never_appear_token",
    "CTX_TOKEN",
    "bearer",
    "Bearer",
  ]) {
    assert.equal(text.includes(leak), false, `leaked ${leak}`);
  }
}

test("parseStackOutputs accepts a query array or a Stacks wrapper", () => {
  assert.deepEqual(parseStackOutputs(null), []);
  assert.deepEqual(parseStackOutputs({}), []);
  const row = { OutputKey: "McpLambdaUrl", OutputValue: MCP_LAMBDA };
  assert.deepEqual(parseStackOutputs([row]), [row]);
  assert.deepEqual(parseStackOutputs({ Outputs: [row] }), [row]);
});

test("pickPublicUrls keeps Amplify + CloudFront and drops secret keys", () => {
  const picked = pickPublicUrls(
    leakyOutputs({ admin: ADMIN, mcp: MCP_LAMBDA, mcpLegacy: MCP_LEGACY })
  );
  assert.deepEqual(picked, { admin: ADMIN, mcp: MCP_LAMBDA, mcpLegacy: MCP_LEGACY });
});

test("pickPublicUrls treats a missing Amplify output as skipped", () => {
  const picked = pickPublicUrls(leakyOutputs({ mcp: MCP_LAMBDA }));
  assert.equal(picked.admin, "");
  assert.equal(picked.mcp, MCP_LAMBDA);
  assert.equal(picked.mcpLegacy, "");
});

test("formatPublicUrls prints admin skipped when Amplify was not created", () => {
  const text = formatPublicUrls(pickPublicUrls(leakyOutputs({ mcp: MCP_LAMBDA })));
  assert.match(text, /admin\s+skipped/);
  assert.match(text, /mcp\s+https:\/\/d111111abcdef8\.cloudfront\.net\/mcp/);
  assert.equal(text.includes("amplifyapp.com"), false);
  assert.equal(text.includes("mcp (legacy)"), false);
  assertNoSecrets(text);
});

test("formatPublicUrls prints the Amplify admin URL when present", () => {
  const text = formatPublicUrls(
    pickPublicUrls(leakyOutputs({ admin: ADMIN, mcp: MCP_LAMBDA }))
  );
  assert.match(text, /admin\s+https:\/\/main\.d1234567890\.amplifyapp\.com/);
  assert.equal(text.includes("skipped"), false);
  assertNoSecrets(text);
});

test("formatPublicUrls labels App Runner as mcp (legacy)", () => {
  const legacyOnly = formatPublicUrls(
    pickPublicUrls(leakyOutputs({ mcpLegacy: MCP_LEGACY }))
  );
  assert.match(legacyOnly, /mcp \(legacy\)\s+https:\/\/abc123\.xx-test-1\.awsapprunner\.com\/mcp/);
  assert.equal(/^\s+mcp\s+https/m.test(legacyOnly), false);
  assertNoSecrets(legacyOnly);

  const both = formatPublicUrls(
    pickPublicUrls(leakyOutputs({ mcp: MCP_LAMBDA, mcpLegacy: MCP_LEGACY }))
  );
  assert.match(both, /mcp\s+https:\/\/d111111abcdef8\.cloudfront\.net\/mcp/);
  assert.match(both, /mcp \(legacy\)\s+https:\/\/abc123\.xx-test-1\.awsapprunner\.com\/mcp/);
  assertNoSecrets(both);
});

test("describeStackOutputs uses the space stack name and region", () => {
  const calls = [];
  const exec = ({ command, args, env }) => {
    calls.push({ command, args, env });
    return describeStacksPayload(leakyOutputs({ mcp: MCP_LAMBDA }));
  };
  const described = describeStackOutputs({
    exec,
    env: { AWS_PROFILE: "findit" },
    region: "xx-test-1",
    stackName: "Context101Testingcontext101",
  });
  assert.equal(described.ok, true);
  assert.deepEqual(calls[0].args, [
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    "Context101Testingcontext101",
    "--region",
    "xx-test-1",
    "--query",
    "Stacks[0].Outputs",
    "--output",
    "json",
  ]);
  assert.equal(pickPublicUrls(described.outputs).mcp, MCP_LAMBDA);
});

test("context101 urls testingcontext101 prints admin skipped and the MCP URL", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-urls-space-"));
  await writeNamedSpace(home, "testingcontext101");
  const io = memoryIo();
  const calls = [];

  const code = await main(["urls", "testingcontext101", "--aws-profile", "findit"], {
    cwd: await mkdtemp(path.join(tmpdir(), "ctx101-urls-cwd-")),
    homeDir: home,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec({
      describeStacks: (spec) => {
        calls.push(spec);
        return describeStacksPayload(leakyOutputs({ mcp: MCP_LAMBDA, mcpLegacy: MCP_LEGACY }));
      },
    }),
  });

  assert.equal(code, 0);
  assert.equal(calls[0].args.includes("Context101Testingcontext101"), true);
  assert.match(io.stdoutText, /admin\s+skipped/);
  assert.match(io.stdoutText, /mcp\s+https:\/\/d111111abcdef8\.cloudfront\.net\/mcp/);
  assert.match(io.stdoutText, /mcp \(legacy\)/);
  assert.equal(io.stdoutText.includes("amplifyapp.com"), false);
  assert.equal(io.stdoutText.includes("paste"), false);
  assertNoSecrets(io.stdoutText);
  assertNoSecrets(io.stderrText);
});

test("context101 url is an alias and accepts list AWS flags", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-url-alias-"));
  await writeNamedSpace(home, "testingcontext101");
  const io = memoryIo();

  const code = await main(
    [
      "url",
      "testingcontext101",
      "--aws-access-key-id",
      "TESTACCESSKEYID12345",
      "--aws-secret-access-key",
      "test-secret-access-key-must-never-appear",
    ],
    {
      cwd: await mkdtemp(path.join(tmpdir(), "ctx101-url-alias-cwd-")),
      homeDir: home,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: fakeExec({
        describeStacks: describeStacksPayload(leakyOutputs({ admin: ADMIN, mcp: MCP_LAMBDA })),
      }),
    }
  );

  assert.equal(code, 0);
  assert.match(io.stdoutText, /admin\s+https:\/\/main\.d1234567890\.amplifyapp\.com/);
  assert.equal(io.stdoutText.includes("TESTACCESSKEYID12345"), false);
  assert.equal(io.stdoutText.includes("test-secret-access-key-must-never-appear"), false);
});

test("context101 urls refuses an unknown space and a missing stack", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-urls-miss-"));
  await writeNamedSpace(home, "testingcontext101");
  const cwd = await mkdtemp(path.join(tmpdir(), "ctx101-urls-miss-cwd-"));

  const unknown = memoryIo();
  const unknownCode = await main(["urls", "nosuchspace"], {
    cwd,
    homeDir: home,
    env: testEnv(),
    stdout: unknown.stdout,
    stderr: unknown.stderr,
    stdin: unknown.stdin,
    exec: fakeExec(),
  });
  assert.equal(unknownCode, 1);
  assert.match(unknown.stderrText, /unknown space nosuchspace/);

  const missing = memoryIo();
  const missingCode = await main(["urls", "testingcontext101"], {
    cwd,
    homeDir: home,
    env: testEnv(),
    stdout: missing.stdout,
    stderr: missing.stderr,
    stdin: missing.stdin,
    exec: fakeExec({ describeStacks: describeStacksPayload([], { ok: false }) }),
  });
  assert.equal(missingCode, 1);
  assert.match(missing.stderrText, /unknown space testingcontext101/);
  assert.equal(missing.stdoutText.includes("mcp"), false);
});

test("context101 urls with several spaces on a non-TTY needs a name", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ctx101-urls-many-"));
  await writeNamedSpace(home, "findit");
  await writeNamedSpace(home, "testingcontext101");
  const io = memoryIo();

  const code = await main(["urls"], {
    cwd: await mkdtemp(path.join(tmpdir(), "ctx101-urls-many-cwd-")),
    homeDir: home,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: fakeExec(),
  });

  assert.equal(code, 1);
  assert.match(io.stderrText, /several spaces/);
});
