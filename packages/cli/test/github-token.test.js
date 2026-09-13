import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyGithubToken,
  githubTokenWorksForAmplify,
  runChecks,
  printChecks,
} from "../src/checks.js";
import { fakeExec, memoryIo } from "./helpers.js";

test("classifyGithubToken recognizes PAT vs installation", () => {
  assert.equal(classifyGithubToken(""), "missing");
  assert.equal(classifyGithubToken("ghp_abc"), "classic_pat");
  assert.equal(classifyGithubToken("github_pat_abc"), "fine_grained_pat");
  assert.equal(classifyGithubToken("ghs_abc"), "installation");
  assert.equal(classifyGithubToken("gho_abc"), "oauth");
  assert.equal(githubTokenWorksForAmplify("classic_pat"), true);
  assert.equal(githubTokenWorksForAmplify("fine_grained_pat"), true);
  assert.equal(githubTokenWorksForAmplify("installation"), false);
  assert.equal(githubTokenWorksForAmplify("oauth"), false);
});

test("runChecks marks a ghs_ gh login as not Amplify-ready", () => {
  const checks = runChecks({
    exec: fakeExec({
      "gh auth token": {
        ok: true,
        code: 0,
        stdout: "ghs_installation_must_never_appear\n",
        stderr: "",
        error: null,
      },
    }),
  });
  assert.equal(checks.gh.loggedIn, true);
  assert.equal(checks.gh.tokenKind, "installation");
  assert.equal(checks.gh.amplifyOk, false);

  const io = memoryIo();
  printChecks(checks, {
    ok: (m) => io.stdout.write(`${m}\n`),
    warn: (m) => io.stderr.write(`${m}\n`),
    dim: (m) => io.stdout.write(`${m}\n`),
  });
  assert.match(`${io.stdoutText}\n${io.stderrText}`, /ghs_|installation/);
  assert.equal(io.stdoutText.includes("ghs_installation_must_never_appear"), false);
  assert.equal(io.stderrText.includes("ghs_installation_must_never_appear"), false);
});
