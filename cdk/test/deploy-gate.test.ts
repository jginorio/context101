import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertGatedContext,
  cdkCommandFromArgv,
} from "../lib/deploy-gate";

test("cdkCommandFromArgv reads deploy/synth/destroy and defaults to synth", () => {
  assert.equal(cdkCommandFromArgv(["node", "cdk", "deploy"]), "deploy");
  assert.equal(cdkCommandFromArgv(["node", "cdk", "synth"]), "synth");
  assert.equal(cdkCommandFromArgv(["node", "cdk", "diff"]), "diff");
  assert.equal(cdkCommandFromArgv(["node", "cdk", "destroy"]), "destroy");
  assert.equal(cdkCommandFromArgv(["node", "cdk"]), "synth");
});

test("assertGatedContext throws on deploy/synth without token", () => {
  assert.throws(
    () => assertGatedContext({ command: "deploy" }),
    /Missing CTX_TOKEN/
  );
  assert.throws(
    () => assertGatedContext({ command: "synth", token: "" }),
    /context101 deploy/
  );
  assert.throws(
    () => assertGatedContext({ command: "diff", token: "   " }),
    /context101 init/
  );
});

test("assertGatedContext allows destroy without tokens", () => {
  assert.doesNotThrow(() => assertGatedContext({ command: "destroy" }));
});

test("assertGatedContext allows deploy with token and no Amplify", () => {
  assert.doesNotThrow(() =>
    assertGatedContext({ command: "deploy", token: "ctx_testtoken_xx" })
  );
});

test("assertGatedContext throws when REPOSITORY is set without githubToken", () => {
  assert.throws(
    () =>
      assertGatedContext({
        command: "deploy",
        token: "ctx_testtoken_xx",
        repository: "https://github.com/acme/context101",
      }),
    /githubToken|GitHub PAT/
  );
});

test("assertGatedContext allows Amplify when both flags are present", () => {
  assert.doesNotThrow(() =>
    assertGatedContext({
      command: "deploy",
      token: "ctx_testtoken_xx",
      githubToken: "ghp_testtoken_xx",
      repository: "https://github.com/acme/context101",
    })
  );
});
