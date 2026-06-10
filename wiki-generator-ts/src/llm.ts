/**
 * Single-turn LLM calls, routed to the configured provider — the TS port of
 * generate.py's invoke_llm / _invoke_bedrock / _invoke_litellm.
 *
 * Bedrock (default) goes through the keyless Converse API via the task role.
 * Bring-your-own providers go through the Vercel AI SDK (the TS analogue of
 * LiteLLM), with the API key fetched once from Secrets Manager. Provider
 * packages are dynamically imported so a Bedrock-only deployment doesn't need
 * them installed.
 *
 * NOTE: targets Vercel AI SDK v5 (`generateText` + `maxOutputTokens`). On
 * v4, the option is named `maxTokens`.
 */

import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { bedrock, secrets } from "./awsClients.js";
import { LLM_KEY_SECRET_ARN, MAX_TOKENS, MODEL_ID, MODEL_PROVIDER } from "./config.js";

let _llmKeyCache: string | null = null;

async function llmApiKey(): Promise<string> {
  if (_llmKeyCache !== null) return _llmKeyCache;
  if (!LLM_KEY_SECRET_ARN) {
    throw new Error(
      `Provider '${MODEL_PROVIDER}' requires an API key but ` +
        "LLM_KEY_SECRET_ARN is not set."
    );
  }
  const resp = await secrets.send(
    new GetSecretValueCommand({ SecretId: LLM_KEY_SECRET_ARN })
  );
  const key = (resp.SecretString ?? "").trim();
  if (!key) throw new Error("LLM API key secret is empty.");
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

/** Single-turn LLM call routed to the configured provider. */
export async function invokeLlm(userText: string): Promise<string> {
  if (MODEL_PROVIDER === "bedrock") return invokeBedrock(userText);
  return invokeAiSdk(userText);
}
