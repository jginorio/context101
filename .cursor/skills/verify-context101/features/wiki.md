# Wiki

Wiki shows generated overview pages for the active brain and can kick a regeneration.

## Sub-features

- `wiki-open` opens `/wiki` and the page list.
- `wiki-read` opens one generated page.
- `wiki-refresh` clicks `Refresh now` — do not run unless asked (Fargate job, minutes, Bedrock spend).

## How to get to it (user POV)

- Open Wiki from the nav (`/wiki`).
- Choose a page in the wiki list.
- Click `Refresh now` in the toolbar.

## Driving it with Chrome DevTools

Preconditions:

- Doctor healthy. Cookie injected. Default brain ready.

- **Open.** Navigate to `/wiki`. Heading/title `Wiki` is visible.
- **Read.** If the index has pages, click one. Markdown content appears. If the index is empty, the empty copy mentions `Refresh now`.
- **Proof.** Screenshot `artifacts/wiki/index.png`. Do not click Refresh now on a default run.

## Gotchas

- Refresh now starts a Fargate wiki generator. It is slow and costs inference. Treat as explicit-only.
- Code wikis are a separate list (`code/` prefix). Team wiki is the default selection.
