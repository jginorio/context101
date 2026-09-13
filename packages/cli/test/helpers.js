import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function tempHome(prefix = "ctx101-home-") {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export async function keepDefaultSpace() {
  return "default";
}

export function testEnv(extra = {}) {
  const env = { ...process.env, NO_COLOR: "1", ...extra };
  if (!Object.hasOwn(extra, "CONTEXT101_SKIP_UPDATE")) {
    env.CONTEXT101_SKIP_UPDATE = "1";
  }
  if (!Object.hasOwn(extra, "AWS_PROFILE")) delete env.AWS_PROFILE;
  if (!Object.hasOwn(extra, "AWS_ACCESS_KEY_ID")) delete env.AWS_ACCESS_KEY_ID;
  if (!Object.hasOwn(extra, "AWS_SECRET_ACCESS_KEY")) delete env.AWS_SECRET_ACCESS_KEY;
  if (!Object.hasOwn(extra, "AWS_SESSION_TOKEN")) delete env.AWS_SESSION_TOKEN;
  if (!Object.hasOwn(extra, "DATABASE_URL")) delete env.DATABASE_URL;
  if (!Object.hasOwn(extra, "CTX_TOKEN")) delete env.CTX_TOKEN;
  if (!Object.hasOwn(extra, "CTX_GH_TOKEN")) delete env.CTX_GH_TOKEN;
  return env;
}

export function exitPromptError(
  message = "User force closed the prompt with SIGINT"
) {
  const error = new Error(message);
  error.name = "ExitPromptError";
  return error;
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
  return ({ command, args = [], cwd } = {}) => {
    const key = [command, ...args].join(" ");
    if (overrides[key]) return overrides[key];

    if (command === "npm" && args[0] === "ci") {
      if (overrides["npm ci"]) return overrides["npm ci"];
      if (cwd && String(cwd).startsWith(tmpdir())) stubCheckoutDeps(cwd);
      return ok("");
    }
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
      if (args[1] === "list-stacks") {
        if (overrides.listStacks) return overrides.listStacks;
        return ok(JSON.stringify({ StackSummaries: [] }));
      }
      return ok("CREATE_COMPLETE");
    }
    if (command === "aws" && args[0] === "configure" && args[1] === "list-profiles") {
      return ok("");
    }
    if (command === "aws" && args[0] === "bedrock") {
      return bedrockReply(args, overrides);
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
      if (args[0] === "clone") {
        return {
          ok: false,
          code: 1,
          stdout: "",
          stderr: "unmocked git clone",
          error: null,
        };
      }
      if (args[0] === "pull" || args.includes("pull")) {
        if (overrides["git pull --ff-only"]) return overrides["git pull --ff-only"];
        if (overrides["git pull"]) return overrides["git pull"];
        return ok("Already up to date.");
      }
      return ok("https://github.com/acme/context101.git");
    }
    return { ok: false, code: 1, stdout: "", stderr: `unmocked: ${key}`, error: null };
  };
}

function argValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : "";
}

function bedrockReply(args, overrides = {}) {
  const sub = args[1];
  if (sub === "list-foundation-models") {
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
  if (sub === "get-foundation-model-availability") {
    const id = argValue(args, "--model-id");
    const status = overrides.bedrockAvailability?.[id] || "AVAILABLE";
    return ok(
      JSON.stringify({
        agreementAvailability: { status },
        entitlementAvailability: status,
      })
    );
  }
  if (sub === "list-foundation-model-agreement-offers") {
    return ok(
      JSON.stringify({
        offers: [
          {
            offerType: "PUBLIC",
            offerToken: "offer-token-must-never-appear",
          },
        ],
      })
    );
  }
  if (sub === "create-foundation-model-agreement") {
    return ok("");
  }
  return {
    ok: false,
    code: 1,
    stdout: "",
    stderr: `unmocked bedrock: ${sub}`,
    error: null,
  };
}

function ok(stdout) {
  return { ok: true, code: 0, stdout, stderr: "", error: null };
}

export function stubCheckoutDeps(root) {
  mkdirSync(path.join(root, "node_modules", "aws-cdk-lib"), { recursive: true });
  mkdirSync(path.join(root, "node_modules", ".bin"), { recursive: true });
  writeFileSync(
    path.join(root, "node_modules", "aws-cdk-lib", "package.json"),
    '{"name":"aws-cdk-lib"}\n'
  );
  writeFileSync(path.join(root, "node_modules", ".bin", "cdk"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
}

export async function makePackedStackFixture(root, { deps = true } = {}) {
  await mkdir(path.join(root, "cdk", "lib"), { recursive: true });
  await writeFile(path.join(root, "cdk", "cdk.json"), '{"app":"npx ts-node bin/context101.ts"}\n', {
    encoding: "utf8",
  });
  await writeFile(path.join(root, "cdk", "package.json"), '{"name":"context101-cdk"}\n', "utf8");
  await writeFile(path.join(root, "cdk", "package-lock.json"), '{"lockfileVersion":3}\n', "utf8");
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
  if (deps) stubCheckoutDeps(path.join(root, "cdk"));
}

export async function makeRepoFixture(root, { deps = true } = {}) {
  await mkdir(path.join(root, "cdk", "lib"), { recursive: true });
  await mkdir(path.join(root, "web"), { recursive: true });
  await writeFile(path.join(root, "cdk", "cdk.json"), '{"app":"npx ts-node bin/context101.ts"}\n', {
    encoding: "utf8",
  });
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
  await writeFile(path.join(root, "package-lock.json"), '{"lockfileVersion":3}\n', "utf8");
  if (deps) stubCheckoutDeps(root);
}

export function mockCloneCheckout(dest) {
  mkdirSync(path.join(dest, "cdk"), { recursive: true });
  mkdirSync(path.join(dest, "web"), { recursive: true });
  writeFileSync(path.join(dest, "cdk", "cdk.json"), "{}\n");
  writeFileSync(path.join(dest, "web", "package.json"), '{"name":"web"}\n');
  writeFileSync(path.join(dest, "package-lock.json"), '{"lockfileVersion":3}\n');
}

export async function writeTestDeployEnv(root, extra = "") {
  const body = ['CTX_TOKEN="ctx_testtoken_xx"', 'APP_MODE="self_hosted"', extra, ""]
    .filter((line) => line !== "")
    .join("\n");
  await writeFile(path.join(root, "cdk", ".deploy-env"), `${body}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}
