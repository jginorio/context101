# Conflicts

Conflicts is a review queue for two documents that disagree. It rhymes with Suggestions. Approve can write GitHub when the loser is a repo file.

## Sub-features

- `conflicts-open` opens `/conflicts` and the pending empty or list state.
- `conflicts-filter` switches Pending / Accepted / Rejected / All.
- `conflicts-list` is `GET /api/conflicts/list?status=`.
- `conflicts-evidence` is `POST /api/conflicts/evidence` (session, MCP bearer, or ingest secret).
- `conflicts-approve` writes the losing source. Do not run against a live GitHub connector in a default run.

## How to get to it (user POV)

- Open Conflicts from the nav (`/conflicts`).
- Filter by status in the sidebar.
- Click a row to open the two-sided sheet.

## Driving it with Chrome DevTools

Preconditions:

- Cookie injected. Default brain ready. Migration `0004_conflicts` applied.

- **Open.** Navigate to `/conflicts`. Heading `Conflicts`. Nav includes `Conflicts` next to `Suggestions`.
- **Empty pending.** Copy includes `No pending conflicts`.
- **Filter.** Click `Accepted`, then `Rejected`, then `All`, then `Pending`.
- **HTTP.** `GET /api/conflicts/list?status=pending` returns `{ items }`. `POST /api/conflicts/approve` without `loserBody` returns 400. `POST /api/conflicts/evidence` without auth returns 401.
- **Proof.** Screenshot `artifacts/conflicts/queue.png`. Suggestions still loads.

## Gotchas

- Detect is fire-and-forget. A retrieve does not wait for a new row.
- Notion and Google losers disable approve (`unwritable-loser`).
- GitHub apply needs App `contents: write` on the install. Existing read-only installs 403 until they accept the permission update.
- Do not approve a real GitHub loser in a default verify run.
