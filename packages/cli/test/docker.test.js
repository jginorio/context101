import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dockerStartHint,
  ensureDockerDaemon,
  listDockerStarters,
} from "../src/docker.js";
import { printChecks, runChecks } from "../src/checks.js";
import { fakeExec, memoryIo } from "./helpers.js";

function fail(stderr = "down") {
  return { ok: false, code: 1, stdout: "", stderr, error: null };
}

function ok(stdout = "") {
  return { ok: true, code: 0, stdout, stderr: "", error: null };
}

test("ensureDockerDaemon is a no-op when docker info works", () => {
  const docker = ensureDockerDaemon({
    exec: fakeExec(),
    platform: "linux",
  });
  assert.equal(docker.installed, true);
  assert.equal(docker.daemon, true);
  assert.equal(docker.started, false);
  assert.equal(docker.hint, null);
});

test("ensureDockerDaemon starts colima when the daemon is down", () => {
  let infoOk = false;
  let colimaStarts = 0;
  const exec = ({ command, args = [] }) => {
    if (command === "sh" && args[1] === "command -v docker") return ok("/usr/bin/docker");
    if (command === "sh" && args[1] === "command -v colima") return ok("/usr/bin/colima");
    if (command === "docker" && args[0] === "info") {
      return infoOk ? ok("Server Version: 24.0.0") : fail("Cannot connect");
    }
    if (command === "colima" && args[0] === "start") {
      colimaStarts += 1;
      infoOk = true;
      return ok("Starting");
    }
    return fail(`unmocked: ${command}`);
  };

  const docker = ensureDockerDaemon({
    exec,
    platform: "darwin",
    wait: () => {},
  });
  assert.equal(colimaStarts, 1);
  assert.equal(docker.daemon, true);
  assert.equal(docker.started, true);
  assert.equal(docker.starter, "colima");
});

test("ensureDockerDaemon does not start anything during dry-run", () => {
  let starts = 0;
  const exec = ({ command, args = [] }) => {
    if (command === "sh" && args[1] === "command -v docker") return ok("/usr/bin/docker");
    if (command === "sh" && args[1] === "command -v colima") return ok("/usr/bin/colima");
    if (command === "docker" && args[0] === "info") return fail("Cannot connect");
    if (command === "colima") {
      starts += 1;
      return ok("");
    }
    return fail(`unmocked: ${command}`);
  };

  const docker = ensureDockerDaemon({
    exec,
    platform: "darwin",
    dryRun: true,
    wait: () => {},
  });
  assert.equal(starts, 0);
  assert.equal(docker.daemon, false);
  assert.match(docker.hint, /colima start/);
  assert.match(docker.hint, /Docker Desktop/);
});

test("ensureDockerDaemon tells the user how to start a down daemon", () => {
  const exec = ({ command, args = [] }) => {
    if (command === "sh" && args[1] === "command -v docker") return ok("/usr/bin/docker");
    if (command === "docker" && args[0] === "info") return fail("Cannot connect");
    return fail(`unmocked: ${command}`);
  };
  const docker = ensureDockerDaemon({
    exec,
    platform: "linux",
    wait: () => {},
  });
  assert.equal(docker.installed, true);
  assert.equal(docker.daemon, false);
  assert.match(docker.hint, /sudo systemctl start docker/);
});

test("listDockerStarters prefers colima then Desktop then systemd", () => {
  const exec = ({ command, args = [] }) => {
    if (command === "sh" && /command -v (colima|systemctl)/.test(args[1] ?? "")) {
      return ok("/usr/bin/tool");
    }
    return fail();
  };
  const linux = listDockerStarters({ exec, platform: "linux" });
  assert.deepEqual(
    linux.map((s) => s.name),
    ["colima", "systemctl"]
  );
  const mac = listDockerStarters({ exec, platform: "darwin" });
  assert.deepEqual(
    mac.map((s) => s.name),
    ["colima", "Docker Desktop"]
  );
});

test("printChecks warns when the docker daemon is down", () => {
  const checks = runChecks({
    exec: fakeExec({
      "docker info": fail("Cannot connect to the Docker daemon"),
    }),
    platform: "linux",
    dryRun: true,
  });
  assert.equal(checks.docker.installed, true);
  assert.equal(checks.docker.daemon, false);

  const io = memoryIo();
  printChecks(checks, {
    ok: (m) => io.stdout.write(`${m}\n`),
    warn: (m) => io.stderr.write(`${m}\n`),
    dim: (m) => io.stdout.write(`${m}\n`),
  });
  assert.match(io.stderrText, /docker daemon is not running/);
});

test("dockerStartHint names the usual starters", () => {
  assert.match(dockerStartHint("linux"), /sudo systemctl start docker/);
  assert.equal(dockerStartHint("darwin").includes("systemctl"), false);
  assert.match(dockerStartHint("darwin"), /colima start/);
});
