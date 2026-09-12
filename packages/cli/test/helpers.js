import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export function testEnv(extra = {}) {
  const env = { ...process.env, NO_COLOR: "1", ...extra };
  if (!Object.hasOwn(extra, "AWS_PROFILE")) delete env.AWS_PROFILE;
  if (!Object.hasOwn(extra, "AWS_ACCESS_KEY_ID")) delete env.AWS_ACCESS_KEY_ID;
  if (!Object.hasOwn(extra, "AWS_SECRET_ACCESS_KEY")) delete env.AWS_SECRET_ACCESS_KEY;
  if (!Object.hasOwn(extra, "AWS_SESSION_TOKEN")) delete env.AWS_SESSION_TOKEN;
  if (!Object.hasOwn(extra, "DATABASE_URL")) delete env.DATABASE_URL;
  return env;
}

export function memoryIo() {
  let out = "";
  let err = "";
  const stdout = {
    isTTY: false,
    write(chunk) {
      out += chunk;
      return true;
    },
  };
  const stderr = {
    isTTY: false,
    write(chunk) {
      err += chunk;
      return true;
    },
  };
  return {
    stdout,
    stderr,
    stdin: { isTTY: false },
    get stdoutText() {
      return out;
    },
    get stderrText() {
      return err;
    },
  };
}

export function fakeExec(overrides = {}) {
  return ({ command, args = [] }) => {
    const key = [command, ...args].join(" ");
    if (overrides[key]) return overrides[key];

    if (command === "npm" && args[0] === "-v") {
      return ok("10.9.2");
    }
    if (command === "aws" && args[0] === "--version") {
      return ok("aws-cli/2.15.0 Python/3.12.0");
    }
    if (command === "aws" && args[0] === "sts") {
      return ok(
        JSON.stringify({
          Account: "123456789012",
          Arn: "arn:aws:iam::123456789012:user/dev",
        })
      );
    }
    if (command === "aws" && args[0] === "cloudformation") {
      return ok("CREATE_COMPLETE");
    }
    if (command === "aws" && args[0] === "configure" && args[1] === "list-profiles") {
      return ok("");
    }
    if (command === "aws" && args[0] === "bedrock") {
      return ok(
        JSON.stringify({
          modelSummaries: [
            {
              modelId: "amazon.titan-embed-text-v2:0",
              providerName: "Amazon",
              modelLifecycle: { status: "ACTIVE" },
            },
            {
              modelId: "amazon.titan-embed-text-v1",
              providerName: "Amazon",
              modelLifecycle: { status: "ACTIVE" },
            },
            {
              modelId: "cohere.embed-english-v3",
              providerName: "Cohere",
              modelLifecycle: { status: "ACTIVE" },
            },
            {
              modelId: "cohere.embed-multilingual-v3:0:512",
              providerName: "Cohere",
              modelLifecycle: { status: "ACTIVE" },
            },
          ],
        })
      );
    }
    if (command === "sh" && args[1] === "command -v docker") {
      return ok("/usr/bin/docker");
    }
    if (command === "docker" && args[0] === "info") {
      return ok("Server Version: 24.0.0");
    }
    if (command === "sh" && args[1] === "command -v gh") {
      return ok("/usr/bin/gh");
    }
    if (command === "gh" && args[0] === "auth") {
      return ok("ghp_test_token_must_never_appear");
    }
    if (command === "gh" && args[0] === "api") {
      return ok("acme-user");
    }
    if (command === "git") {
      return ok("https://github.com/acme/context101.git");
    }
    return { ok: false, code: 1, stdout: "", stderr: `unmocked: ${key}`, error: null };
  };
}

function ok(stdout) {
  return { ok: true, code: 0, stdout, stderr: "", error: null };
}

export async function makeRepoFixture(root) {
  await mkdir(path.join(root, "cdk", "lib"), { recursive: true });
  await mkdir(path.join(root, "web"), { recursive: true });
  await writeFile(path.join(root, "cdk", "deploy.sh"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  await writeFile(
    path.join(root, "cdk", ".deploy-env.example"),
    'CTX_TOKEN="example-do-not-copy"\n',
    "utf8"
  );
  await writeFile(
    path.join(root, "cdk", "lib", "context101-stack.ts"),
    'repository: "https://github.com/jginorio/context101",\n',
    "utf8"
  );
  await writeFile(path.join(root, "web", "package.json"), '{"name":"web"}\n', "utf8");
}
