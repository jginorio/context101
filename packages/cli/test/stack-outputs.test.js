import assert from "node:assert/strict";
import { test } from "node:test";
import {
  asOutputMap,
  formatAdminUrl,
  parseStackOutputs,
  pickAdminRepoCloneUrl,
  pickAdminUrl,
} from "../src/stack-outputs.js";

test("parseStackOutputs maps OutputKey to OutputValue", () => {
  const map = parseStackOutputs([
    { OutputKey: "WebAppDefaultDomain", OutputValue: "https://main.d123.amplifyapp.com" },
    { OutputKey: "AdminRepoCloneUrl", OutputValue: "https://git-codecommit.us-west-2.amazonaws.com/v1/repos/x" },
    { OutputKey: "DocsBucketName", OutputValue: "context101-docs" },
  ]);
  assert.equal(pickAdminUrl(map), "https://main.d123.amplifyapp.com");
  assert.equal(
    pickAdminRepoCloneUrl(map),
    "https://git-codecommit.us-west-2.amazonaws.com/v1/repos/x"
  );
  assert.equal(formatAdminUrl(pickAdminUrl(map)), "admin  https://main.d123.amplifyapp.com");
});

test("parseStackOutputs swallows non-JSON and never invents an admin URL", () => {
  assert.deepEqual(parseStackOutputs("CREATE_COMPLETE"), {});
  assert.deepEqual(parseStackOutputs("None"), {});
  assert.equal(pickAdminUrl({}), "");
  assert.equal(formatAdminUrl(""), "");
});

test("formatAdminUrl does not print secrets", () => {
  const line = formatAdminUrl("https://main.d123.amplifyapp.com");
  assert.equal(line.includes("ghp_"), false);
  assert.equal(line.includes("CTX_TOKEN"), false);
  assert.equal(line.includes("DATABASE_URL"), false);
});

test("pickAdminRepoCloneUrl accepts urls.js describe shape", () => {
  const described = {
    ok: true,
    outputs: [
      { OutputKey: "AdminRepoCloneUrl", OutputValue: "https://git-codecommit.us-west-2.amazonaws.com/v1/repos/x" },
      { OutputKey: "WebAppDefaultDomain", OutputValue: "https://main.d123.amplifyapp.com" },
    ],
  };
  assert.equal(
    pickAdminRepoCloneUrl(described),
    "https://git-codecommit.us-west-2.amazonaws.com/v1/repos/x"
  );
  assert.equal(pickAdminUrl(described), "https://main.d123.amplifyapp.com");
  assert.equal(asOutputMap(described).DocsBucketName, undefined);
});
