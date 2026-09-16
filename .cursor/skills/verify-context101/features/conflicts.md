# Conflicts (parked)

Conflicts is **parked** on main. Detect/judge (Opus) is unwired from
query, ingest, and MCP. Isolated restore is `cursor/conflicts-isolated-de63`.

Default verification is: no Conflicts nav and `/conflicts` redirects to
`/knowledge`.

## Sub-features

- `conflicts-parked` (default) — nav has no Conflicts; `/conflicts`
  redirects.

## How to get to it (user POV)

You cannot. There is no Conflicts nav item.

## Driving it with Chrome DevTools

Preconditions:

- Cookie injected.

- **Parked.** On `/knowledge`, App nav has Knowledge, Suggestions,
  Sources, Brains — not Conflicts. Navigate to `/conflicts`: the app
  lands on Knowledge (redirect).
- **Proof.** Screenshot `artifacts/conflicts/parked.png`.

## Gotchas

- `CONFLICT_JUDGE=off` is not the shipping control — the detect plumbing
  is gone from retrieve, ingest, and MCP.
- Do not wait on `/conflicts` as ingest proof. Use `bin/retrieve`.
