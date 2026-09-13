import assert from "node:assert/strict";
import { test } from "node:test";
import { main } from "./run-main.js";
import {
  compareSemver,
  isNewerVersion,
  maybeOfferUpdate,
  newerVersionNotice,
  npmInstallSpec,
  parseNpmVersion,
  shouldSkipUpdate,
  updateNowMessage,
  versionLine,
} from "../src/update.js";
import { fakeExec, memoryIo, testEnv } from "./helpers.js";

function updateEnv(extra = {}) {
  return testEnv({ CONTEXT101_SKIP_UPDATE: "", ...extra });
}

function ttyIo() {
  const io = memoryIo();
  io.stdout.isTTY = true;
  io.stdin.isTTY = true;
  return io;
}

test("parseNpmVersion and compareSemver", () => {
  assert.equal(parseNpmVersion("0.1.6\n"), "0.1.6");
  assert.equal(parseNpmVersion('"0.1.6"'), "0.1.6");
  assert.equal(parseNpmVersion("not-a-version"), null);
  assert.equal(parseNpmVersion("context101-cli@latest"), null);
  assert.equal(isNewerVersion("0.1.6", "0.1.5"), true);
  assert.equal(isNewerVersion("0.1.5", "0.1.5"), false);
  assert.equal(isNewerVersion("0.1.4", "0.1.5"), false);
  assert.equal(compareSemver("0.2.0", "0.1.9") > 0, true);
  assert.equal(updateNowMessage("0.1.6"), "0.1.6 is out. update now?");
  assert.equal(updateNowMessage("0.1.6").includes("—"), false);
  assert.equal(newerVersionNotice("0.1.6"), "0.1.6 is out");
  assert.equal(npmInstallSpec("0.1.6"), "context101-cli@0.1.6");
  assert.equal(npmInstallSpec("latest"), null);
});

test("newer version prompts and yes installs the pinned version", async () => {
  const io = ttyIo();
  const installs = [];
  let asked = null;
  let listed = false;

  const code = await main(["help"], {
    cwd: "/tmp",
    env: updateEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    packageVersion: "0.1.5",
    fetchNpmLatest: async () => "0.1.6",
    confirmUpdate: async (version) => {
      asked = version;
      return true;
    },
    installCli: async (spec) => {
      installs.push(spec);
      return true;
    },
    exec: (spec) => {
      if (spec.command === "aws") listed = true;
      return fakeExec()(spec);
    },
  });

  assert.equal(code, 0);
  assert.equal(asked, "0.1.6");
  assert.deepEqual(installs, ["context101-cli@0.1.6"]);
  assert.equal(installs.some((spec) => String(spec).includes("@latest")), false);
  assert.match(io.stdoutText, /Context101/);
  assert.match(io.stdoutText, /re-run context101/);
  assert.equal(io.stdoutText.includes("Usage: context101"), false);
  assert.equal(listed, false);
  assert.equal(io.stdoutText.includes("@latest"), false);
});

test("yes uses npm i -g with the exact version, never @latest", async () => {
  const io = ttyIo();
  const npmCalls = [];

  const code = await main(["list"], {
    cwd: "/tmp",
    env: updateEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    packageVersion: "0.1.5",
    confirmUpdate: async () => true,
    exec: (spec) => {
      if (spec.command === "npm") {
        npmCalls.push(spec);
        return { ok: true, code: 0, stdout: "0.1.6", stderr: "", error: null };
      }
      return fakeExec()(spec);
    },
  });

  assert.equal(code, 0);
  const view = npmCalls.find((spec) => spec.args?.[0] === "view");
  const install = npmCalls.find((spec) => spec.args?.[0] === "i");
  assert.deepEqual(view.args, ["view", "context101-cli", "version"]);
  assert.equal(view.timeout, 2000);
  assert.deepEqual(install.args, ["i", "-g", "context101-cli@0.1.6"]);
  assert.equal(install.args.includes("context101-cli@latest"), false);
  assert.equal(install.env?.CONTEXT101_UPDATING, "1");
  assert.match(io.stdoutText, /re-run context101/);
  assert.equal(io.stdoutText.includes("No Context101 deployments"), false);
});

test("no continues the original command", async () => {
  const io = ttyIo();
  let installed = false;

  const code = await main(["help"], {
    cwd: "/tmp",
    env: updateEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    packageVersion: "0.1.5",
    fetchNpmLatest: async () => "0.1.6",
    confirmUpdate: async () => false,
    installCli: async () => {
      installed = true;
      return true;
    },
  });

  assert.equal(code, 0);
  assert.equal(installed, false);
  assert.match(io.stdoutText, /Usage: context101 <command>/);
  assert.equal(io.stdoutText.includes("re-run context101"), false);
});

test("registry failure does not fail list or help", async () => {
  const listIo = memoryIo();
  const helpIo = memoryIo();
  let asked = false;

  const listCode = await main(["list"], {
    cwd: "/tmp",
    env: updateEnv(),
    stdout: listIo.stdout,
    stderr: listIo.stderr,
    stdin: listIo.stdin,
    packageVersion: "0.1.5",
    fetchNpmLatest: async () => {
      throw new Error("ENOTFOUND registry.npmjs.org");
    },
    confirmUpdate: async () => {
      asked = true;
      return true;
    },
    exec: fakeExec(),
  });

  const helpCode = await main(["help"], {
    cwd: "/tmp",
    env: updateEnv(),
    stdout: helpIo.stdout,
    stderr: helpIo.stderr,
    stdin: helpIo.stdin,
    packageVersion: "0.1.5",
    fetchNpmLatest: async () => {
      throw new Error("timeout");
    },
    confirmUpdate: async () => {
      asked = true;
      return true;
    },
  });

  assert.equal(listCode, 0);
  assert.equal(helpCode, 0);
  assert.equal(asked, false);
  assert.match(listIo.stdoutText, /No Context101 spaces/);
  assert.match(helpIo.stdoutText, /Usage: context101 <command>/);
  assert.equal(listIo.stderrText.includes("ENOTFOUND"), false);
  assert.equal(helpIo.stderrText.includes("timeout"), false);
});

test("non-TTY skips prompt and does not block", async () => {
  const io = memoryIo();
  let asked = false;
  let installed = false;

  const code = await main(["help"], {
    cwd: "/tmp",
    env: updateEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    packageVersion: "0.1.5",
    fetchNpmLatest: async () => "0.1.6",
    confirmUpdate: async () => {
      asked = true;
      return true;
    },
    installCli: async () => {
      installed = true;
      return true;
    },
  });

  assert.equal(code, 0);
  assert.equal(asked, false);
  assert.equal(installed, false);
  assert.match(io.stdoutText, /0\.1\.6 is out/);
  assert.match(io.stdoutText, /Usage: context101 <command>/);
  assert.equal(io.stdoutText.includes("update now"), false);
  assert.equal(io.stdoutText.includes("re-run context101"), false);
});

test("--yes and --dry-run skip the update prompt", async () => {
  for (const opts of [{ yes: true }, { dryRun: true }]) {
    const io = ttyIo();
    let asked = false;
    const code = await maybeOfferUpdate(opts, {
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      env: updateEnv(),
      packageVersion: "0.1.5",
      fetchNpmLatest: async () => "0.1.6",
      confirmUpdate: async () => {
        asked = true;
        return true;
      },
    });
    assert.equal(code, null);
    assert.equal(asked, false);
    assert.match(io.stdoutText, /0\.1\.6 is out/);
    assert.equal(io.stdoutText.includes("update now"), false);
  }
});

test("same version does not prompt", async () => {
  const io = ttyIo();
  let asked = false;
  const code = await main(["help"], {
    cwd: "/tmp",
    env: updateEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    packageVersion: "0.1.5",
    fetchNpmLatest: async () => "0.1.5",
    confirmUpdate: async () => {
      asked = true;
      return true;
    },
  });
  assert.equal(code, 0);
  assert.equal(asked, false);
  assert.equal(io.stdoutText.includes("is out"), false);
  assert.match(io.stdoutText, /Usage: context101 <command>/);
});

test("version, -v, and --version skip the update check", async () => {
  for (const argv of [["version"], ["-v"], ["--version"]]) {
    const io = ttyIo();
    let fetched = false;
    let asked = false;
    const code = await main(argv, {
      cwd: "/tmp",
      env: updateEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      packageVersion: "0.1.6",
      fetchNpmLatest: async () => {
        fetched = true;
        return "9.9.9";
      },
      confirmUpdate: async () => {
        asked = true;
        return true;
      },
      installCli: async () => {
        throw new Error("should not install");
      },
    });
    assert.equal(code, 0);
    assert.equal(fetched, false);
    assert.equal(asked, false);
    assert.equal(io.stdoutText, "context101-cli 0.1.6\n");
    assert.equal(io.stdoutText.includes("your context. every agent."), false);
    assert.equal(shouldSkipUpdate({ command: "version" }, { env: updateEnv() }), true);
    assert.equal(versionLine({ packageVersion: "0.1.6" }), "context101-cli 0.1.6");
  }
});

test("CONTEXT101_SKIP_UPDATE skips the check (no recurse)", async () => {
  const io = ttyIo();
  let fetched = false;
  const code = await main(["help"], {
    cwd: "/tmp",
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    packageVersion: "0.1.5",
    fetchNpmLatest: async () => {
      fetched = true;
      return "0.1.6";
    },
  });
  assert.equal(code, 0);
  assert.equal(fetched, false);
  assert.match(io.stdoutText, /Usage: context101 <command>/);
});

test("update check never prints npm tokens", async () => {
  const io = ttyIo();
  const token = "npm_secret_token_must_never_appear";
  const code = await main(["help"], {
    cwd: "/tmp",
    env: updateEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    packageVersion: "0.1.5",
    fetchNpmLatest: async () => `0.1.6\n${token}`,
    confirmUpdate: async () => false,
  });
  assert.equal(code, 0);
  const text = `${io.stdoutText}\n${io.stderrText}`;
  assert.equal(text.includes(token), false);
});
