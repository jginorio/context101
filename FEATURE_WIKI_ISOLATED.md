# Isolated wiki restore

This branch is **not** shipping main. It restores wiki UI + `/wiki/settings`
on top of the sources+retrieve strip so wiki can be tested alone.

## Restored

- Wiki nav, Ask the brain, Go to wiki
- `/wiki`, `/wiki/ask`, `/wiki/settings`
- Wiki model / BYO keys at `/wiki/settings` (not Settings → Advanced)

## Still off (do not flip)

- EventBridge `WikiGenSchedule` stays disabled
- `AUTO_TRIGGER_CODE_WIKI` stays `false`
- Conflicts stay parked (no Opus judge)

See `WIKI_PARKED.md` on main (`cursor/strip-wiki-conflicts-de63` / PR #78).

<!-- bump: clear stale Vercel commit status after public project deleted -->
