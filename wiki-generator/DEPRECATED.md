# ⚠️ Deprecated

This Python wiki generator has been **superseded by the TypeScript port** in
[`../wiki-generator-ts/`](../wiki-generator-ts/). The TS version is the image
that CDK now builds and deploys to the wiki Fargate task
(`cdk/lib/context101-stack.ts` → `WikiGenImage`).

## Why it's still here

It is retained only as a **reference / rollback target**: point the
`WikiGenImage` asset `directory` back at `wiki-generator/` to revert to the
Python implementation. That's the sole reason it hasn't been deleted.

## What you lose by using it

The Python generator is frozen at behavioral parity with the original and gets
**no new features**. Notably, the subscription-backed model providers
(`MODEL_PROVIDER=claude-code` / `codex`, which generate the wiki against a
Claude Pro/Max or ChatGPT Plus/Pro **subscription** instead of metered API
tokens) exist **only** in the TypeScript generator.

## If you're making changes

Make them in [`../wiki-generator-ts/`](../wiki-generator-ts/) and do not port
them back here. When the rollback path is no longer needed, this directory can
be deleted outright.
