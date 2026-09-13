import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import * as path from "path";

export const PG_HTTP_REL = path.join("nodejs", "pg-http");
export const PG_HTTP_NPM_INSTALL =
  "npm install --omit=dev --no-audit --no-fund --loglevel=error";

export function pgHttpDockerCommand(): string {
  return [
    "cp -R . /asset-output",
    "cd /asset-output/nodejs",
    PG_HTTP_NPM_INSTALL,
    "mkdir -p node_modules",
    "cp -R pg-http node_modules/pg-http",
  ].join(" && ");
}

export function pgHttpLocalCommand(src: string, outputDir: string): string {
  return [
    `cp -R "${src}/." "${outputDir}/"`,
    `cd "${outputDir}/nodejs"`,
    PG_HTTP_NPM_INSTALL,
    "mkdir -p node_modules",
    "cp -R pg-http node_modules/pg-http",
  ].join(" && ");
}

export function assertPgHttpManifest(src: string): void {
  const pkgPath = path.join(src, "nodejs", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const deps = pkg.dependencies || {};
  const pgHttp = deps["pg-http"];
  if (pgHttp && (/file:/.test(pgHttp) || pgHttp.includes("node_modules/pg-http"))) {
    throw new Error(
      "pg-http layer must not use a file: dependency into its own node_modules"
    );
  }
  if (!existsSync(path.join(src, PG_HTTP_REL, "package.json"))) {
    throw new Error("pg-http layer is missing nodejs/pg-http");
  }
}

export function stagePgHttpIntoNodeModules(nodejsDir: string): void {
  const from = path.join(nodejsDir, "pg-http");
  const to = path.join(nodejsDir, "node_modules", "pg-http");
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

export function tryBundlePgHttp(
  src: string,
  outputDir: string,
  run: (command: string, options?: { cwd?: string; stdio?: string; env?: NodeJS.ProcessEnv }) => unknown = execSync
): boolean {
  try {
    assertPgHttpManifest(src);
    cpSync(src, outputDir, { recursive: true });
    run(PG_HTTP_NPM_INSTALL, {
      cwd: path.join(outputDir, "nodejs"),
      stdio: "pipe",
      env: {
        ...process.env,
        npm_config_update_notifier: "false",
      },
    });
    stagePgHttpIntoNodeModules(path.join(outputDir, "nodejs"));
    return existsSync(path.join(outputDir, "nodejs", "node_modules", "pg-http", "index.js"));
  } catch {
    return false;
  }
}
