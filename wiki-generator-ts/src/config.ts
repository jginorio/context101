/**
 * Configuration — a faithful port of the env handling at the top of
 * wiki-generator/generate.py. Every variable, default, and normalization
 * rule mirrors the Python generator so the two can be diffed.
 */

const env = process.env;

function reqEnv(name: string): string {
  const v = env[name];
  if (v === undefined || v === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function truthy(v: string | undefined): boolean {
  return ["1", "true", "yes"].includes((v ?? "").toLowerCase());
}

export const AWS_REGION = env.AWS_REGION ?? "us-east-1";
export const AWS_PROFILE = env.AWS_PROFILE;
export const DOCS_BUCKET = reqEnv("DOCS_BUCKET");

let _wikiPrefix = env.WIKI_PREFIX ?? "wiki/";
if (!_wikiPrefix.endsWith("/")) _wikiPrefix += "/";
export const WIKI_PREFIX = _wikiPrefix;

// WIKI_MODE: "main" (default) generates the cross-source team wiki at
// wiki/<slug>.md. "code" generates a per-repo deepwiki-style wiki under
// wiki/code/<repo-slug>/<slug>.md, with code-specialized prompts and corpus
// scoped to a single repo.
export const WIKI_MODE = env.WIKI_MODE ?? "main";

// CORPUS_PREFIX scopes the input corpus to a single S3 prefix. Empty = whole
// bucket (main mode). Set to e.g. "sources/github/<repo-slug>/" for code mode.
let _corpusPrefix = env.CORPUS_PREFIX ?? "";
if (_corpusPrefix && !_corpusPrefix.endsWith("/")) _corpusPrefix += "/";
export const CORPUS_PREFIX = _corpusPrefix;

// REPO_FULL_NAME ("owner/repo") is interpolated into code-mode prompts so the
// model knows which repo it's documenting. Ignored in main mode.
export const REPO_FULL_NAME = env.REPO_FULL_NAME ?? "";

export const MODEL_ID = env.MODEL_ID ?? "us.anthropic.claude-opus-4-7";

// Wiki model provider. "bedrock" (default) uses the keyless Bedrock path via
// the task role. Bring-your-own providers ("anthropic", "openai", "grok",
// "gemini") are routed through the Vercel AI SDK (the TS analogue of the
// Python generator's LiteLLM path) with an API key fetched from
// LLM_KEY_SECRET_ARN.
export const MODEL_PROVIDER = (env.MODEL_PROVIDER ?? "bedrock").toLowerCase();
export const LLM_KEY_SECRET_ARN = env.LLM_KEY_SECRET_ARN;

export const MIN_PAGES = parseInt(env.MIN_PAGES ?? "4", 10);
export const MAX_PAGES = parseInt(env.MAX_PAGES ?? "8", 10);
export const CORPUS_PREVIEW_CHARS = parseInt(env.CORPUS_PREVIEW_CHARS ?? "600", 10);
// Cap the structure-pass corpus summary. Docs are selected round-robin across
// source areas to stay within this budget while keeping every area represented.
export const CORPUS_SUMMARY_MAX_CHARS = parseInt(
  env.CORPUS_SUMMARY_MAX_CHARS ?? "240000",
  10
);
export const MAX_TOKENS = parseInt(env.MAX_TOKENS ?? "8192", 10);

// WIKI_FORCE=1 bypasses the no-change corpus-hash guard.
export const WIKI_FORCE = truthy(env.WIKI_FORCE);

export const XML_DUMP_PATH = env.XML_DUMP_PATH ?? "/tmp/wiki-structure-broken.xml";

// ── Experimental, gbrain-inspired extensions (OFF by default) ───────────
// These are flag-gated so the faithful port stays behaviorally identical to
// the Python generator until you deliberately opt in. Keeping them off lets
// you diff TS output against Python output to prove the port is correct;
// flipping them on is a separate "do the new features work?" check.
// See README.md.

// WIKI_AUTOLINK=1 — compute each page's related_pages deterministically from
// shared source files instead of using the model's per-run guesses. Stable
// across runs and free (no LLM call). gbrain idea #1.
export const WIKI_AUTOLINK = truthy(env.WIKI_AUTOLINK);

// WIKI_GAPS=1 — ask the structure pass to also emit a <gaps> section (topics
// the corpus references but doesn't cover) and persist it to _meta.json.
// gbrain idea #2.
export const WIKI_GAPS = truthy(env.WIKI_GAPS);
