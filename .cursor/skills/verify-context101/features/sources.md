# Data sources list

`/sources` (heading **Data sources**) lists connected connectors. Adding a source is [add-source](./add-source.md). This file is the list + ERROR detail.

## Sub-features

- `src-list` shows each connector card (label, status pill, Added by, account/workspace, Last synced, Items).
- `src-error-accordion` — when status is `error` and `last_error` is set, the raw blob is **not** shown open. An accordion trigger shows a one-line summary (status + short message, e.g. `401 unauthorized — API token is invalid.`). Opening the item reveals the full `last_error` in monospace / pre-wrap. Closed by default. Shared by Notion and any other connector that uses this card.

## How to get to it (user POV)

- App nav: link `Sources` → `/sources`.
- Heading **Data sources**.
- Sidebar **Add a source** panel: **Upload files**, **Google**, **Notion**, **GitHub** (same four rows as the picker). Not Docs / Sheets / Slides.
- Empty list copy: “connect a Google file, Notion workspace, or GitHub repo.”

## Driving it with Chrome DevTools

Preconditions: doctor healthy, cookie injected. Do **not** click **Sync now**, **Add new source** (that opens the picker — drive it via [add-source](./add-source.md)), or remove a source in a default run.

- **List.** Navigate to `/sources`. Cards render for each connector. Sidebar shows the four add rows above.
- **ERROR accordion (when a card is ERROR).** The trigger is the one-line summary, not the raw JSON. Click it to expand the full error; click again to collapse. Proof: screenshot `artifacts/sources/01-error-collapsed.png` with the summary visible and the JSON hidden; optional `02-error-open.png` after expand.

## Gotchas

- Connected cards have no accordion. The error UI is the same component for every connector type.
- Opening **Add new source** is the picker ([add-source](./add-source.md)); do not submit the Google / Notion / GitHub form. Do not **Sync now** or remove a source in a default run.
- Knowledge sidebar still fans Google synced trees into Docs / Sheets / Slides. That is the library tree, not the add-source menu.
