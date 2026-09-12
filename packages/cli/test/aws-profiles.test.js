import assert from "node:assert/strict";
import { test } from "node:test";
import {
  listAwsProfiles,
  parseAwsConfigProfiles,
  parseAwsCredentialsProfiles,
  resolveAwsAuth,
  resolveAwsProfile,
} from "../src/aws-profiles.js";

test("parses credentials and config profile names", () => {
  assert.deepEqual(
    parseAwsCredentialsProfiles("[default]\n[findit]\n[plateapr]\n"),
    ["default", "findit", "plateapr"]
  );
  assert.deepEqual(
    parseAwsConfigProfiles(
      "[default]\n[profile findit]\n[profile plateapr]\n[sso-session work]\n"
    ),
    ["default", "findit", "plateapr"]
  );
});

test("listAwsProfiles prefers aws configure list-profiles", () => {
  const names = listAwsProfiles({
    exec: () => ({ ok: true, stdout: "default\nfindit\nplateapr\n" }),
    env: { HOME: "/no/such/home" },
  });
  assert.deepEqual(names, ["default", "findit", "plateapr"]);
});

test("listAwsProfiles falls back to ini files when aws CLI cannot list", () => {
  const files = {
    "/tmp/aws-home/.aws/credentials": "[default]\naws_access_key_id=x\n",
    "/tmp/aws-home/.aws/config": "[profile findit]\nregion=xx-test-1\n",
  };
  const names = listAwsProfiles({
    exec: () => ({ ok: false, stdout: "" }),
    env: { HOME: "/tmp/aws-home" },
    readFile: (filePath) => {
      if (!files[filePath]) {
        const err = new Error("missing");
        err.code = "ENOENT";
        throw err;
      }
      return files[filePath];
    },
  });
  assert.deepEqual(names, ["default", "findit"]);
});

test("resolveAwsProfile uses an explicit flag, else the only profile", () => {
  assert.equal(
    resolveAwsProfile({
      explicit: "plateapr",
      profiles: ["findit", "plateapr"],
    }).profile,
    "plateapr"
  );
  assert.equal(
    resolveAwsProfile({ explicit: null, profiles: ["findit"] }).profile,
    "findit"
  );
  assert.equal(
    resolveAwsProfile({ explicit: null, profiles: [] }).profile,
    null
  );
});

test("resolveAwsProfile asks when several profiles exist", () => {
  const asked = resolveAwsProfile({
    explicit: null,
    profiles: ["findit", "plateapr"],
    dryRun: true,
  });
  assert.equal(asked.source, "ask-profile");
  assert.equal(asked.profile, null);
  assert.deepEqual(asked.profiles, ["findit", "plateapr"]);

  const yes = resolveAwsProfile({
    explicit: null,
    profiles: ["findit", "plateapr"],
    yes: true,
  });
  assert.match(yes.error, /multiple AWS profiles/);
  assert.match(yes.error, /--aws-profile/);
});

test("resolveAwsAuth asks for access keys when no profiles exist", () => {
  const asked = resolveAwsAuth({
    profiles: [],
    dryRun: true,
  });
  assert.equal(asked.source, "ask-keys");
  assert.equal(asked.profile, null);

  const fromEnv = resolveAwsAuth({
    profiles: [],
    accessKeyId: "TESTACCESSKEYID12345",
    secretAccessKey: "test-secret-access-key-must-never-appear",
  });
  assert.equal(fromEnv.source, "keys");
  assert.equal(fromEnv.accessKeyId, "TESTACCESSKEYID12345");

  const yes = resolveAwsAuth({ profiles: [], yes: true });
  assert.equal(yes.source, "default-chain");
});
