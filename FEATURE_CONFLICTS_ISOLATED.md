# Isolated conflicts restore

This branch is **not** shipping main. It restores Conflicts UI, evidence
hooks, and the Opus judge on top of the sources+retrieve strip so
conflicts can be tested alone.

## Restored

- Conflicts nav and `/conflicts`
- `reportEvidence` on admin retrieve / chat
- Ingest `CONFLICT_EVIDENCE_URL` posts
- MCP `search_knowledge` evidence posts
- `web/lib/conflicts/` detect + judge

## Still off

- Wiki chrome stays parked (`/wiki*` redirects)
- EventBridge wiki schedule stays disabled
- `AUTO_TRIGGER_CODE_WIKI` stays `false`

See PR #78 (`cursor/strip-wiki-conflicts-de63`) for the shipping strip.

<!-- bump: clear stale Vercel commit status after public project deleted -->
