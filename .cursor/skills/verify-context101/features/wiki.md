# Wiki

Wiki chrome is **gated off** by default (`WIKI_UI_ENABLED` in `web/lib/wiki-ui.ts`). Generation stays paused; do not click Refresh now or re-enable schedules.

Default verification is: no Wiki nav, `/wiki` (and nested, including `/wiki/settings`) redirect to `/knowledge`, and Settings → Advanced has embeddings only. Retrieve stays `POST /api/wiki/retrieve` via `bin/retrieve`.

## Sub-features

- `wiki-ui-hidden` (default) — nav has no Wiki; `/wiki` redirects; Settings has no wiki model tab.
- `wiki-open` — only when `WIKI_UI_ENABLED` is true: `/wiki` and the page list.
- `wiki-settings` — only when the flag is true: `/wiki/settings` (toolbar **Settings** on `/wiki`). Not under Settings → Advanced.
- `wiki-ask` — only when the flag is true: `/wiki/ask`.
- `wiki-retrieve` — HTTP retrieve (`POST /api/wiki/retrieve`). This is the default ingest proof path.
- `wiki-refresh` — `Refresh now` on `/wiki`. Do not run unless asked.

## How to get to it (user POV)

While the flag is off: you cannot. There is no Wiki nav item and no sidebar **Go to wiki** / **Ask the brain**.

When the flag is on: Wiki nav → `/wiki`. **Settings** in the wiki toolbar → `/wiki/settings`. **Ask the brain** → `/wiki/ask`.

## Driving it with Chrome DevTools

Preconditions:

- Doctor healthy. Cookie injected.

- **Hidden (default).** On `/knowledge`, App nav has Knowledge, Suggestions, Conflicts, Sources, Brains — not Wiki. Settings has Organization + Advanced (embeddings), not Wiki regeneration or Wiki model. Navigate to `/wiki` or `/wiki/settings`: the app lands on Knowledge (redirect).
- **Open (flag on only).** Navigate to `/wiki`. Heading/title `Wiki` is visible.
- **Settings (flag on only).** From `/wiki`, button `Settings` → `/wiki/settings`. Heading `Wiki settings`. Card `Wiki generation model`.
- **Ask (flag on only).** Navigate to `/wiki/ask`. Heading `Ask the brain`.
- **Proof.** Screenshot `artifacts/wiki/hidden.png` (nav without Wiki). Do not click Refresh now on a default run.

## Gotchas

- Wiki generation is paused/beta. Do not click Refresh now unless explicitly asked.
- Wiki model/API-key controls are colocated at `/wiki/settings`, not Settings → Advanced.
- `/api/wiki/retrieve` still works while the UI is hidden. Prefer it over `/wiki/ask`.
- Retrieve and Ask also fire-and-forget conflict evidence (`reportEvidence`). The retrieve JSON does not include a new Conflicts row; do not wait on `/conflicts` as ingest proof. See [conflicts](./conflicts.md).
