# Context101 verification map

This directory is the maintained source for verifying user-facing Context101 behavior (Next.js admin and the self-host CLI). Read this index, then drive the matching feature file.

## Baseline preconditions

- Admin recipes need `:3000` plus `.cursor/skills/verify-context101/bin/doctor` (`doctor: healthy`). CLI recipes need the `context101` bin (or `npx context101-cli`), an AWS profile/creds, and the `aws` CLI for `list` / `urls` / `destroy --dry-run`; they do not need `:3000`.
- Admin is healthy at `http://localhost:3000`.
- `.cursor/skills/verify-context101/bin/doctor` prints `doctor: healthy`.
- Session is the `CONTEXT101_USER` account. Shared instances usually already have a ready brain; a new stack has none and the header says `No brains yet` / `Create a brain`.
- Mutating runs use a unique prefix `verify/<run-id>/` and record it in `/tmp/verify-context101-run.id`.
- Do not start a second Next.js on `:3000`. Reuse the environment instance when doctor passes.
- Chrome DevTools: inject the session cookie and open `/knowledge`. Skip `/login` if the agent browser cannot render the WebGL login shell.

## Driving conventions

- Start every recipe from `/knowledge` on Default unless the feature says otherwise.
- Prefer ARIA names (`New file`, `Rename`, treeitem filenames) over CSS or coordinates.
- Right-click via `evaluate_script` `contextmenu` on the tree row, then click the menuitem.
- After every mutation, confirm with `bin/files list` / `bin/files get`.
- After create/rename/move/delete, prove the vector index with `bin/retrieve` (see [library-ingest](./library-ingest.md)).
- Restore by deleting the `verify/<run-id>/` prefix. Keep artifacts.

## Proof and skip reporting

- UI proof: screenshot or ARIA snapshot with the Knowledge heading visible.
- HTTP proof: request, JSON body, and HTTP 200.
- Mutation proof: a second list/get that shows the new key and not the old one.
- Record the feature ID on every artifact filename.
- An unreachable entry point is a skip with the failed command, not a pass via another path.

## Features

- [Library files](./library-files.md) — create, rename, drag-move, OS-upload, and delete uploaded files and folders (primary).
- [Library ingest](./library-ingest.md) — wait until Bedrock Retrieve ranks the new key after those mutations.
- [Knowledge viewer](./knowledge-viewer.md) — open a file, preview, edit, save.
- [Add source](./add-source.md) — open the picker (do not submit a connector in a default run).
- [Data sources list](./sources.md) — connector cards; ERROR last_error is an accordion (collapsed summary, full text on open).
- [GitHub source](./github-source.md) — org-scoped GitHub App (Connect GitHub / repo picker); PAT is fallback only. Do not install or submit in a default run.
- [Login](./login.md) — email sign-in and session cookie. `/setup` is first admin only (skip when an org exists).
- [Brains](./brains.md) — switch and inspect brains (do not provision, delete, or retry-delete brains in a default run).
- [Wiki](./wiki.md) — parked on main; prove redirect + no nav. Retrieve is `bin/retrieve`.
- [Conflicts](./conflicts.md) — parked on main; prove redirect + no nav. No Opus judge on query/ingest.
- [CLI](./cli.md) — context101-cli AWS front door: help / list / help urls / destroy --dry-run (no checkout). Live `urls <space>` is optional. Do not init --force or deploy in a default run.
