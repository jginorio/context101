/**
 * Single-turn LLM calls, routed to the configured provider — the TS port of
 * generate.py's invoke_llm / _invoke_bedrock / _invoke_litellm, plus the
 * subscription-backed CLI-agent path the Python generator never had.
 *
 * Bedrock (default) goes through the keyless Converse API via the task role.
 * Bring-your-own providers go through the Vercel AI SDK (the TS analogue of
 * LiteLLM), with the API key fetched once from Secrets Manager.
 *
 * Subscription providers ("claude-code", "codex") drive the real coding-agent
 * CLI as a local subprocess inside this container — Claude via the stable
 * `@anthropic-ai/claude-agent-sdk` (`query()`), Codex via `codex exec`. Both
 * authenticate with the user's OAuth *subscription* (Claude Pro/Max, ChatGPT
 * Plus/Pro) read from env, not a metered API key. Running the CLI locally
 * (rather than the AI SDK 7 `HarnessAgent`, which needs a port-exposing remote
 * sandbox) keeps generation inside the Fargate task we already pay to run.
 * Provider packages are dynamically imported so a Bedrock-only deployment
 * doesn't need them installed.
 *
 * NOTE: targets Vercel AI SDK v5 (`generateText` + `maxOutputTokens`). On
 * v4, the option is named `maxTokens`.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { bedrock, secrets } from "./awsClients.js";
import {
  HARNESS_MODEL,
  LLM_KEY_SECRET_ARN,
  MAX_TOKENS,
  MODEL_ID,
  MODEL_PROVIDER,
} from "./config.js";

let _llmKeyCache: string | null = null;

async function llmApiKey(): Promise<string> {
  if (_llmKeyCache !== null) return _llmKeyCache;
  if (!LLM_KEY_SECRET_ARN) {
    throw new Error(
      `Provider '${MODEL_PROVIDER}' requires a credential but ` +
        "LLM_KEY_SECRET_ARN is not set."
    );
  }
  const resp = await secrets.send(
    new GetSecretValueCommand({ SecretId: LLM_KEY_SECRET_ARN })
  );
  const key = (resp.SecretString ?? "").trim();
  if (!key) throw new Error("LLM credential secret is empty.");
  _llmKeyCache = key;
  return key;
}

async function invokeBedrock(userText: string): Promise<string> {
  const resp = await bedrock.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      messages: [{ role: "user", content: [{ text: userText }] }],
      inferenceConfig: { maxTokens: MAX_TOKENS },
    })
  );
  const content = resp.output?.message?.content ?? [];
  return content
    .map((block) => block.text ?? "")
    .join("")
    .trim();
}

async function invokeAiSdk(userText: string): Promise<string> {
  if (!MODEL_ID) {
    throw new Error(`MODEL_ID is required for provider '${MODEL_PROVIDER}'.`);
  }
  const apiKey = await llmApiKey();
  const { generateText } = await import("ai");

  let model;
  switch (MODEL_PROVIDER) {
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      model = createAnthropic({ apiKey })(MODEL_ID);
      break;
    }
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      model = createOpenAI({ apiKey })(MODEL_ID);
      break;
    }
    case "grok": {
      const { createXai } = await import("@ai-sdk/xai");
      model = createXai({ apiKey })(MODEL_ID);
      break;
    }
    case "gemini": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      model = createGoogleGenerativeAI({ apiKey })(MODEL_ID);
      break;
    }
    default:
      throw new Error(`Unsupported wiki model provider: ${MODEL_PROVIDER}`);
  }

  const { text } = await generateText({
    model,
    prompt: userText,
    maxOutputTokens: MAX_TOKENS,
  });
  return (text ?? "").trim();
}

// System instruction that pins the coding agent to a single-turn,
// documentation-writing role. The wiki corpus is passed inline in the prompt
// (same as every other provider), so the agent must NOT explore a workspace,
// edit files, or run shell commands — just answer.
const AGENT_SYSTEM =
  "You are a documentation generator. Follow the user's instructions exactly " +
  "and return only the requested document, with no preamble or commentary. " +
  "Do not use tools, read or edit files, or run shell commands.";

/**
 * Load the subscription OAuth credential from Secrets Manager into the place
 * each agent CLI reads it from:
 *   - claude-code → CLAUDE_CODE_OAUTH_TOKEN env var (from `claude setup-token`)
 *   - codex       → $CODEX_HOME/auth.json           (the blob `codex login` writes)
 * Because the CLI runs as a local child process, the host's process env / files
 * are exactly what it authenticates against.
 */
let _subscriptionAuthLoaded = false;

async function loadSubscriptionAuth(): Promise<void> {
  const cred = await llmApiKey();
  if (MODEL_PROVIDER === "claude-code") {
    // OAuth tokens contain no whitespace; strip any that crept in (e.g. a
    // newline from copying the line-wrapped `claude setup-token` output) so a
    // mangled paste doesn't reach the API as an "Invalid bearer token" 401.
    process.env.CLAUDE_CODE_OAUTH_TOKEN = cred.replace(/\s+/g, "");
    // Ensure a stray API-key env var can't take precedence over the token.
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    return;
  }
  // codex: persist the `codex login` auth blob to CODEX_HOME/auth.json.
  const home = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  await mkdir(home, { recursive: true });
  await writeFile(join(home, "auth.json"), cred, { mode: 0o600 });
  process.env.CODEX_HOME = home;
}

/**
 * Claude Pro/Max subscription generation via the stable Claude Agent SDK, which
 * spawns the bundled `claude` CLI as a local subprocess. Tools are disabled and
 * the turn count capped so it behaves as a single-shot text generator — the
 * corpus is already inlined in `userText`.
 */
async function invokeClaudeCode(userText: string): Promise<string> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  const result = query({
    prompt: userText,
    options: {
      systemPrompt: AGENT_SYSTEM,
      maxTurns: 1,
      allowedTools: [], // no workspace/file/shell tools — answer only
      ...(HARNESS_MODEL ? { model: HARNESS_MODEL } : {}),
    },
  });

  for await (const message of result) {
    if (message.type === "result") {
      if (message.subtype === "success") return message.result.trim();
      throw new Error(
        `claude-code generation failed (${message.subtype}).`
      );
    }
  }
  throw new Error("claude-code produced no result message.");
}

/**
 * ChatGPT Plus/Pro subscription generation via the Codex CLI's non-interactive
 * `codex exec`, run as a local subprocess. The CLI authenticates from
 * CODEX_HOME/auth.json (written by loadSubscriptionAuth). Note: the Codex CLI's
 * non-interactive contract is less stable than the Claude Agent SDK — treat
 * this path as best-effort and re-check the flags on CLI upgrades.
 */
async function invokeCodex(userText: string): Promise<string> {
  // The prompt is piped via stdin (the `-` prompt arg tells `codex exec` to
  // read instructions from stdin). Wiki prompts routinely exceed Linux's 128KB
  // per-argument limit (MAX_ARG_STRLEN) — the corpus summary alone is capped at
  // CORPUS_SUMMARY_MAX_CHARS (240k) — so they cannot be passed as argv without
  // an E2BIG failure. The final answer is captured via --output-last-message
  // rather than scraped from stdout framing. Sandbox is read-only so the agent
  // can't write to the workspace; it's instructed not to use tools at all.
  const prompt = `${AGENT_SYSTEM}\n\n${userText}`;
  const outFile = join(tmpdir(), `codex-out-${randomUUID()}.txt`);
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--color",
    "never",
    "--output-last-message",
    outFile,
  ];
  if (HARNESS_MODEL) args.push("--model", HARNESS_MODEL);
  args.push("-");

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("codex", args, {
        env: process.env,
        stdio: ["pipe", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`codex exec exited ${code}: ${stderr.trim()}`));
      });
      child.stdin.end(prompt);
    });
    return (await readFile(outFile, "utf8")).trim();
  } finally {
    await rm(outFile, { force: true });
  }
}

/** Single-turn LLM call routed to the configured provider. */
export async function invokeLlm(userText: string): Promise<string> {
  if (MODEL_PROVIDER === "bedrock") return invokeBedrock(userText);
  if (MODEL_PROVIDER === "claude-code" || MODEL_PROVIDER === "codex") {
    if (!_subscriptionAuthLoaded) {
      await loadSubscriptionAuth();
      _subscriptionAuthLoaded = true;
    }
    return MODEL_PROVIDER === "claude-code"
      ? invokeClaudeCode(userText)
      : invokeCodex(userText);
  }
  return invokeAiSdk(userText);
}
