# Wiki Generator (TypeScript port)

A TypeScript rewrite of [`../wiki-generator/`](../wiki-generator/) (Python).
This exists **alongside** the Python generator so the TS version can be
validated against it before anything is swapped in deployment. The Python
generator is still the one wired into CDK/ECS — nothing here is deployed yet.

## Goal: behavioral parity, then improvements

With its experimental flags **off** (the default), this port is a faithful
1:1 of the Python generator — same corpus filtering, same no-change hash, same
slug algorithm, same XML handling, same `_index.json` / `_meta.json` shape,
same stale-page pruning. JSON is even serialized Python-style (`ensure_ascii`,
`", "` separators) so the structural files diff cleanly.

Two [gbrain](https://github.com/garrytan/gbrain)-inspired features are added
behind flags, **off by default**, so the parity diff stays meaningful:

| Flag | Default | What it does |
|------|---------|--------------|
| `WIKI_AUTOLINK` | off | Compute each page's `related_pages` deterministically from shared source files, instead of the model's per-run guesses. Stable across runs, no LLM cost. |
| `WIKI_GAPS` | off | Ask the structure pass to also emit a `<gaps>` list (topics the corpus references but doesn't cover) and persist it to `_meta.json`. |
| `WIKI_INCREMENTAL` | off | Regenerate only the pages a corpus change actually touches, instead of rebuilding the whole wiki. See below. |

## Incremental regeneration (`WIKI_INCREMENTAL`)

The full rebuild re-plans and regenerates every page on any corpus change. At
scale that's slow and expensive. With `WIKI_INCREMENTAL=1`, the generator
instead does the minimum work a change requires, using the page→source graph
that's already persisted in `_index.json` (each page lists its `sources`) plus
a per-file etag manifest written to `_meta.json`.

**Three tiers:**

1. **Changed / deleted source → regenerate only the pages that cite it.** No
   structure pass, no LLM planning call. A page whose sources are all deleted
   is removed; other affected pages are re-synthesized with their updated
   source set.
2. **Added source → route it.** One cheap LLM call decides whether each new
   doc folds into existing page(s) or warrants a new page; only the affected
   pages are (re)generated.
3. **Full re-plan.** `WIKI_FORCE=1` (the manual "Refresh now" button, which
   `start-wiki-gen` already sets) always does a full rebuild, so the structure
   can reorganize and never ossifies. Scheduled/auto runs go incremental.

**Identity is stable.** Existing pages keep their id, title, and slug across
incremental runs — only content (and sources, on add/delete) changes. That
also resolves the slug-churn problem the full path works around with pruning.

**Implies deterministic linking.** The model's per-run `related_pages` can't be
maintained across partial updates, so incremental always computes
`related_pages` from shared sources (same logic as `WIKI_AUTOLINK`).

**Fallbacks.** First run, missing prior `_index.json`/manifest, or unusable
routing output all fall back to a full re-plan automatically.

**`_meta.json` gains a `source_manifest`** (`{ "s3/key.md": "etag", … }`,
key-sorted) when this flag is on — that's the per-file fingerprint the next run
diffs against. It's omitted when the flag is off, preserving the parity diff.

**Caveat:** code-wiki link freshness. Code wikis are referenced, not ingested,
and aren't in the manifest, so a code-wiki change doesn't trigger incremental
page regen — those links refresh on the next full re-plan.

## Layout

```
src/
  config.ts      env parsing (mirrors generate.py's config block)
  awsClients.ts  S3 / Bedrock / Secrets Manager clients
  prompts.ts     loads the verbatim prompt templates from src/prompts/*.txt
  prompts/       the four prompt templates, copied 1:1 from prompts.py
  corpus.ts      list / hash / load / round-robin summary / code-wiki catalog
  llm.ts         Bedrock (default) + bring-your-own via the Vercel AI SDK
  structure.ts   XML extraction + parsing + slugify
  autolink.ts    deterministic related_pages (WIKI_AUTOLINK)
  outputs.ts     page/sidecar/index/meta writes + pruning
  pyjson.ts      Python-compatible JSON serialization (for clean diffs)
  generate.ts    main() orchestration
  index.ts       entry point
```

## Run locally

```bash
npm install
# Faithful mode (matches Python):
DOCS_BUCKET=my-brain-bucket AWS_PROFILE=my-profile npm run dev
# Build + run the compiled output:
npm run build && DOCS_BUCKET=my-brain-bucket npm start
```

All env vars from the Python generator are honored identically:
`AWS_REGION`, `AWS_PROFILE`, `DOCS_BUCKET` (required), `WIKI_PREFIX`,
`WIKI_MODE`, `CORPUS_PREFIX`, `REPO_FULL_NAME`, `MODEL_ID`, `MODEL_PROVIDER`,
`LLM_KEY_SECRET_ARN`, `MIN_PAGES`, `MAX_PAGES`, `CORPUS_PREVIEW_CHARS`,
`CORPUS_SUMMARY_MAX_CHARS`, `MAX_TOKENS`, `WIKI_FORCE`, `XML_DUMP_PATH`. The TS
generator adds `HARNESS_MODEL` (see below).

## Model providers

`MODEL_PROVIDER` selects how each LLM call is made:

| Value | Auth | How |
|-------|------|-----|
| `bedrock` (default) | keyless (task role) | Bedrock Converse API |
| `anthropic` / `openai` / `grok` / `gemini` | API key in `LLM_KEY_SECRET_ARN` | Vercel AI SDK |
| `claude-code` | **Claude Pro/Max subscription** OAuth token | Claude Agent SDK (local `claude` subprocess) |
| `codex` | **ChatGPT Plus/Pro subscription** auth | `codex exec` (local subprocess) |

### Subscription providers (`claude-code`, `codex`)

These bill generation to a **subscription** instead of metered API tokens. The
coding-agent CLI runs as a local subprocess *inside the wiki Fargate task* — no
remote sandbox, no extra service — so the only marginal cost is the compute you
already pay for. (We deliberately do **not** use the AI SDK 7 `HarnessAgent`:
its `claude-code`/`codex` adapters are bridge-backed and require a
port-exposing remote sandbox — only `@ai-sdk/sandbox-vercel` is published, and
the local `just-bash` provider is rejected. Driving the CLI directly keeps
everything in-container.)

**Credential.** `LLM_KEY_SECRET_ARN` holds the subscription credential:

- `claude-code` → the token from `claude setup-token`, exported as
  `CLAUDE_CODE_OAUTH_TOKEN` for the bundled `claude` CLI.
- `codex` → the contents of `~/.codex/auth.json` produced by `codex login`,
  written to `$CODEX_HOME/auth.json` before `codex exec` runs.

**Model.** Set `HARNESS_MODEL` to pick the agent model (e.g. `opus`,
`claude-opus-4-7` for claude-code; `gpt-5-codex` for codex). Unset defers to
each CLI's default. `MODEL_ID` is Bedrock-shaped and ignored by these providers.

**Image.** `claude-code` needs no extra install — the `claude` CLI ships inside
`@anthropic-ai/claude-agent-sdk`. `codex` needs the `codex` binary; build the
image with `--build-arg WIKI_CODEX_CLI=1` (kept off by default so the standard
image stays lean).

**Maturity.** The `claude-code` path uses the **stable** Claude Agent SDK. The
`codex` path shells out to `codex exec`, whose non-interactive contract is less
stable — treat it as best-effort and re-check the flags on CLI upgrades.

> **⚠️ Terms of Service.** Claude Pro/Max and ChatGPT Plus/Pro subscriptions are
> licensed for interactive personal use. Using a subscription OAuth token to
> drive automated, server-side generation may violate the provider's terms, and
> the token can be revoked. This is a billing/licensing decision, not just an
> engineering one — confirm it's permitted for your usage before enabling these
> in production. The API-key (`anthropic`/`openai`) and `bedrock` paths are the
> terms-safe options.

## Validating against the Python generator (diff run)

The LLM-authored page bodies are non-deterministic, so a full byte diff is
impossible — validate the **deterministic surfaces** instead:

1. Point the TS run at a separate prefix so the two don't clobber each other:
   ```bash
   # Python (existing): writes wiki/
   # TS (this port):
   DOCS_BUCKET=my-bucket WIKI_PREFIX=wiki-ts/ WIKI_FORCE=1 npm run dev
   ```
2. Compare the structural outputs and behavior:
   - **`_meta.json`** — `corpus_sha` MUST match the Python run for the same
     corpus (it's a pure hash of the same inputs). This is the strongest
     equivalence check and needs no LLM determinism.
   - **`_index.json`** — same page count; `slug`, `importance`, and `sources`
     derived identically given the same plan.
   - **Pruning** — re-run and confirm stale pages are removed, code wikis under
     `wiki/code/` left untouched in main mode.
   - **No-change guard** — re-run without `WIKI_FORCE` and confirm it skips.
3. Then flip the flags on (`WIKI_AUTOLINK=1`, `WIKI_GAPS=1`) and eyeball the
   new behavior separately — that's a different "do the features work?" check,
   not part of the parity diff.

## Known non-equivalences (all intentional / unavoidable)

- **Page bodies** differ every run (LLM nondeterminism) — not portable.
- **`generated_at` / `finished_at`** use JS ISO format (`…Z`, millisecond
  precision) vs Python's (`+00:00`, microseconds). Timestamps, so irrelevant.
- **Unicode key sorting** uses JS UTF-16 order vs Python code-point order;
  identical for ASCII keys (the corpus keys in practice).

## Deployment note

Not wired into CDK. To actually ship it, the wiki ECS task definition's image
asset would point at this Dockerfile instead of `../wiki-generator/`. Do that
only after the diff run above checks out.
