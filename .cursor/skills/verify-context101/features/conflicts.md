# Conflicts

Conflicts is a review queue for two documents that disagree. It rhymes with Suggestions. Approve can write GitHub when the loser is a repo file, then the rendered S3 body.

## Sub-features

- `conflicts-open` opens `/conflicts` and the pending empty or list state.
- `conflicts-filter` switches Pending / Accepted / Rejected / All in the sidebar.
- `conflicts-search` filters the loaded rows (client-side; placeholder `Search conflicts…`).
- `conflicts-refresh` reloads via button `Refresh`.
- `conflicts-sheet` opens the review sheet by clicking a row (title is the conflict title).
- `conflicts-list` is `GET /api/conflicts/list?status=`.
- `conflicts-evidence` is `POST /api/conflicts/evidence` (session, MCP bearer, or ingest secret).
- `conflicts-approve` writes the losing source. Do not run against a live GitHub connector in a default run. A real apply can change S3 and the vector index — if you ever run it, prove with `bin/files` and [library-ingest](./library-ingest.md).

## How to get to it (user POV)

- Open Conflicts from the nav (`/conflicts`).
- Filter by **Status** in the sidebar (`Pending`, `Accepted`, `Rejected`, `All`).
- Search with `Search conflicts…`. Reload with `Refresh`.
- Click a row to open the two-sided sheet. Pending sheet actions: `Keep left`, `Keep right`, `Merge`, then `Approve` or `Reject`.

## Driving it with Chrome DevTools

Preconditions:

- Cookie injected. Default brain ready. Migration `0004_conflicts` applied.

- **Open (driven).** Navigate to `/conflicts`. Heading `Conflicts`. Nav includes `Conflicts` next to `Suggestions`.
- **Empty pending (driven).** Copy includes `No pending conflicts. Query and ingest report disagreements here.`
- **Filter (driven).** Click `Accepted` (`No accepted conflicts.`), then `Rejected` (`No rejected conflicts.`), then `All`, then `Pending`.
- **Search / refresh (code-guaranteed; search driven only when rows exist).** Placeholder `Search conflicts…`. Empty search copy is `No conflicts match your search.` Button `Refresh` re-fetches the current status.
- **Sheet (code-guaranteed; skip when the queue is empty).** Click a pending row. Sheet title is the conflict title. Buttons `Keep left`, `Keep right`, `Merge`. Footer `Reject` and `Approve`. `Approve` is disabled when the chosen loser is Notion or Google. Row icon buttons use `title="Keep left"` and `title="Reject"` (no accessible name). Prefer the sheet buttons.
- **HTTP (driven).** `GET /api/conflicts/list?status=pending` returns `{ items }`. `POST /api/conflicts/approve` without `loserBody` returns 400. `POST /api/conflicts/evidence` without auth returns 401. Session evidence returns `{ ok: true }` without waiting for detect.
- **Proof.** Screenshot `artifacts/conflicts/queue.png`. Suggestions still loads (`/suggestions`).

## Gotchas

- Detect is fire-and-forget. `bin/retrieve` and `/wiki/ask` do not wait for a new row, and the retrieve JSON does not include it.
- Notion and Google losers disable approve (`unwritable-loser`). Copy: `Notion and Google losers cannot be written back yet.`
- GitHub apply needs App `contents: write` on the install. Existing read-only installs 403 until they accept the permission update.
- Do not approve a real GitHub loser in a default verify run.
- Evidence is also posted from ingest (`CONFLICT_EVIDENCE_URL`) and MCP `search_knowledge`. Those paths are out of this skill’s UI scope.
