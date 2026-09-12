# Wiki

Wiki shows generated overview pages for the active brain and can kick a regeneration.

## Sub-features

- `wiki-open` opens `/wiki` and the page list.
- `wiki-read` opens one generated page.
- `wiki-ask` opens `/wiki/ask` (Ask the brain) and shows Retrieved context keys.
- `wiki-retrieve` is the HTTP form of that retrieve (`POST /api/wiki/retrieve`).
- `wiki-refresh` clicks `Refresh now` — do not run unless asked (Fargate job, minutes, Bedrock spend).

## How to get to it (user POV)

- Open Wiki from the nav (`/wiki`).
- Choose a page in the wiki list.
- Open Ask the brain (`/wiki/ask` or the sidebar action).
- Click `Refresh now` in the toolbar.

## Driving it with Chrome DevTools

Preconditions:

- Doctor healthy. Cookie injected. Default brain ready.

- **Open.** Navigate to `/wiki`. Heading/title `Wiki` is visible.
- **Read.** If the index has pages, click one. Markdown content appears. If the index is empty, the empty copy mentions `Refresh now`.
- **Ask.** Navigate to `/wiki/ask`. Heading `Ask the brain`. Fill textbox `Ask this brain` and submit. Retrieved context lists source keys. For ingest remap proof, follow [library-ingest](./library-ingest.md) instead of polling this page.
- **Proof.** Screenshot `artifacts/wiki/index.png`. Do not click Refresh now on a default run.

## Gotchas

- Wiki generation is paused/beta; default verification is raw-first retrieve/Ask (`bin/retrieve`, `/wiki/ask`). Do not click Refresh now unless explicitly asked.
- Refresh now starts a Fargate wiki generator. It is slow and costs inference. Treat as explicit-only.
- Code wikis are a separate list (`code/` prefix). Team wiki is the default selection.
- `/wiki/ask` streams Claude after retrieve. Poll `bin/retrieve`, not this page.
- Retrieve and Ask also fire-and-forget conflict evidence (`reportEvidence`). The retrieve JSON does not include a new Conflicts row; do not wait on `/conflicts` as ingest proof. See [conflicts](./conflicts.md).
