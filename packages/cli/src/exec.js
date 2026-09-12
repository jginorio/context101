import { spawn, spawnSync } from "node:child_process";
import { DEPLOY_WRAPPER } from "./defaults.js";

export function createExec(baseEnv = process.env) {
  return function exec({ command, args = [], env, cwd, timeout = 15_000 }) {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      timeout,
      env: { ...baseEnv, ...env },
      cwd,
    });
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const code = result.status ?? (result.error ? 1 : 0);
    return {
      ok: code === 0,
      code,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      error: result.error ?? null,
    };
  };
}

export function commandExists(exec, name) {
  const result = exec({ command: "sh", args: ["-c", `command -v ${name}`] });
  return result.ok && Boolean(result.stdout);
}

export function runDeployWrapper({ repoRoot, seed, env, stdio = "inherit" }) {
  const args = seed ? ["--seed"] : [];
  return new Promise((resolve, reject) => {
    const child = spawn(DEPLOY_WRAPPER, args, {
      cwd: repoRoot,
      env,
      stdio,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve(code ?? 1);
    });
  });
}
