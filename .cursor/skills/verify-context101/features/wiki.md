# Wiki (parked)

Wiki chrome is **parked** on main. Generation stays paused. Do not click
Refresh now or re-enable EventBridge / `AUTO_TRIGGER_CODE_WIKI`.

See [WIKI_PARKED.md](../../../../WIKI_PARKED.md) at the repo root.

Default verification is: no Wiki nav, `/wiki` (and nested) redirect to
`/knowledge`, and Settings → Advanced has embeddings only. Retrieve stays
`POST /api/wiki/retrieve` via `bin/retrieve`. Isolated restore is
`cursor/wiki-isolated-de63`.

## Sub-features

- `wiki-parked` (default) — nav has no Wiki; `/wiki` redirects; Settings
  has no wiki model tab.
- `wiki-retrieve` — HTTP retrieve (`POST /api/wiki/retrieve`). This is
  the default ingest proof path.

## How to get to it (user POV)

You cannot. There is no Wiki nav item and no sidebar **Go to wiki** /
**Ask the brain**.

## Driving it with Chrome DevTools

Preconditions:

- Doctor healthy. Cookie injected.

- **Parked.** On `/knowledge`, App nav has Knowledge, Suggestions,
  Sources, Brains — not Wiki, not Conflicts. Settings has Organization +
  Advanced (embeddings), not Wiki regeneration or Wiki model. Navigate
  to `/wiki`: the app lands on Knowledge (redirect).
- **Proof.** Screenshot `artifacts/wiki/parked.png` (nav without Wiki).
  Do not click Refresh now.

## Gotchas

- Wiki generation is paused/beta. Do not click Refresh now unless
  explicitly asked on an isolated wiki branch.
- `/api/wiki/retrieve` still works. Prefer it over `/wiki/ask`.
- Retrieve does not fire conflict evidence.
