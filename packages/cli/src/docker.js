import { commandExists } from "./exec.js";

export function dockerDaemonRunning(exec) {
  const result = exec({
    command: "docker",
    args: ["info"],
    timeout: 15_000,
  });
  return Boolean(result.ok);
}

export function dockerStartHint(platform = process.platform) {
  const lines = [
    "Start the Docker daemon, then run context101 deploy:",
    "  · Docker Desktop — open the app and wait until it is running",
    "  · Colima — colima start",
  ];
  if (platform === "linux") {
    lines.push("  · Linux — sudo systemctl start docker");
  }
  return lines.join("\n");
}

export function listDockerStarters({ exec, platform = process.platform } = {}) {
  const starters = [];
  if (commandExists(exec, "colima")) {
    starters.push({
      name: "colima",
      command: "colima",
      args: ["start"],
      timeout: 120_000,
    });
  }
  if (platform === "darwin") {
    starters.push({
      name: "Docker Desktop",
      command: "open",
      args: ["-a", "Docker"],
      timeout: 20_000,
    });
  }
  if (platform === "linux" && commandExists(exec, "systemctl")) {
    starters.push({
      name: "systemctl",
      command: "systemctl",
      args: ["start", "docker"],
      timeout: 20_000,
    });
  }
  return starters;
}

export function ensureDockerDaemon({
  exec,
  platform = process.platform,
  dryRun = false,
  wait = defaultWait,
  attempts = 8,
} = {}) {
  if (!commandExists(exec, "docker")) {
    return {
      installed: false,
      daemon: false,
      started: false,
      starter: null,
      hint: "Install Docker (or Colima) so CDK can build the wiki-gen and MCP images.",
    };
  }
  if (dockerDaemonRunning(exec)) {
    return {
      installed: true,
      daemon: true,
      started: false,
      starter: null,
      hint: null,
    };
  }
  if (dryRun) {
    return {
      installed: true,
      daemon: false,
      started: false,
      starter: null,
      hint: dockerStartHint(platform),
    };
  }

  for (const starter of listDockerStarters({ exec, platform })) {
    const launched = exec({
      command: starter.command,
      args: starter.args,
      timeout: starter.timeout,
    });
    if (!launched.ok) continue;
    for (let i = 0; i < attempts; i++) {
      if (dockerDaemonRunning(exec)) {
        return {
          installed: true,
          daemon: true,
          started: true,
          starter: starter.name,
          hint: null,
        };
      }
      wait(500);
    }
  }

  return {
    installed: true,
    daemon: false,
    started: false,
    starter: null,
    hint: dockerStartHint(platform),
  };
}

function defaultWait(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
