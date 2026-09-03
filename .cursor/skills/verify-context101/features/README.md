# Context101 verification map

This directory is the maintained source for verifying user-facing behavior of the Context101 admin. Read this index, then drive the matching feature file.

## Baseline preconditions

- Admin is healthy at `http://localhost:3000`.
- `.cursor/skills/verify-context101/bin/doctor` prints `doctor: healthy`.
- Session is the `CONTEXT101_USER` account; active brain is **Default**.
- Mutating runs use a unique prefix `verify/<run-id>/` and record it in `/tmp/verify-context101-run.id`.
- Do not start a second Next.js on `:3000`. Reuse the environment instance when doctor passes.
- Chrome DevTools: inject the session cookie and open `/knowledge`. Skip `/login` (Aurora WebGL crashes this agent Chrome).

## Driving conventions

- Start every recipe from `/knowledge` on Default unless the feature says otherwise.
- Prefer ARIA names (`New file`, `Rename`, treeitem filenames) over CSS or coordinates.
- Right-click via `evaluate_script` `contextmenu` on the tree row, then click the menuitem.
- After every mutation, confirm with `bin/files list` / `bin/files get`.
- Restore by deleting the `verify/<run-id>/` prefix. Keep artifacts.

## Proof and skip reporting

- UI proof: screenshot or ARIA snapshot with the Knowledge heading visible.
- HTTP proof: request, JSON body, and HTTP 200.
- Mutation proof: a second list/get that shows the new key and not the old one.
- Record the feature ID on every artifact filename.
- An unreachable entry point is a skip with the failed command, not a pass via another path.

## Features

- [Library files](./library-files.md) — create, rename, and delete uploaded files and folders (primary).
- [Knowledge viewer](./knowledge-viewer.md) — open a file, preview, edit, save.
- [Login](./login.md) — email sign-in and session cookie.
- [Brains](./brains.md) — switch and inspect brains (do not provision or delete brains in a default run).
- [Wiki](./wiki.md) — open the wiki index and a page; do not click Refresh now unless asked.
