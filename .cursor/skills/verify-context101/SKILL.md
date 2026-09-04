---
name: verify-context101
description: Drive the Context101 Next.js admin (Knowledge library, wiki, brains) in a browser or via /api/files to prove user-facing behavior. Use when verifying create/rename/move/delete, login, wiki, or brains against a real running app.
---

# Verify Context101

Context101's primary surface is the **Next.js admin** in `web/` (Knowledge library, wiki, suggestions, sources, brains). The MCP server and marketing `site/` are out of scope here.

Agents that have never seen this repo should follow this file cold: launch or reuse `:3000`, run doctor, drive a mapped feature through the real UI or the authenticated file APIs, capture proof, then clean up scratch keys only.

## Launch

Reuse the environment instance when it is already healthy. Do **not** start a second Next.js process on `:3000`.

```bash
source .cursor/skills/verify-context101/bin/aws-env
.cursor/skills/verify-context101/bin/launch
```

Ready when `curl -sS -o /dev/null -w '%{http_code}' http://localhost:3000/login` returns `200` (or a redirect) and doctor reports `GET /api/files/list` succeeds.

The environment `start` script is `npm --prefix web run dev` and typically already holds `:3000`. That process often **lacks AWS credentials**. File mutations then fail with `Could not load credentials from any providers`. If doctor says S3 is broken:

1. Note the existing `next-server` / `next dev` PIDs (`pgrep -af 'next-server|next dev'`).
2. Stop **those PIDs only** (`kill <pid>`), never `pkill -f`.
3. `source .cursor/skills/verify-context101/bin/aws-env && npm --prefix web run dev`.

`aws-env` uses `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` when set. If those are empty, it copies the first `*_aws_access_key_id` / `*_aws_secret_access_key` pair from the process environment (host-injected aliases). It sets `AWS_REGION` from `SES_REGION` or `AWS_DEFAULT_REGION` when present. It never prints key material.

Required env for a driveable instance:

- `CONTEXT101_USER` / `CONTEXT101_PASSWORD` — Better Auth email sign-in (values stay in the environment; do not write them into this skill or into artifacts)
- `DATABASE_URL` — already required by the app
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (or a host alias pair as above)

If `BETTER_AUTH_URL` is a hosted origin, browser `fetch` to `/api/auth/sign-in/email` from `http://localhost:3000` returns `INVALID_ORIGIN`. Sign in with **curl** (no Origin header) via `bin/auth-cookie`.

## Doctor

```bash
.cursor/skills/verify-context101/bin/doctor
```

Expect `doctor: healthy`. That means HTTP is up, sign-in issues a cookie, `/api/auth/get-session` has a user, and `/api/files/list` returns `{ folders, files }` (Next can talk to the default brain's S3 bucket).

If anything looks off, run doctor before guessing. Do not drive a shared instance that fails S3 — you will not get real create/rename/delete.

## Drive

Two harnesses, both going through the **same user-facing routes**:

1. **Chrome DevTools MCP** (browser) — Knowledge UI, context menus, dialogs.
2. **`bin/files`** (HTTP) — `PUT/GET/list/move/delete` on `/api/files/*` with a session cookie.
3. **`bin/retrieve`** (HTTP) — `POST /api/wiki/retrieve` (Bedrock Retrieve, no Claude). Use this to wait until the vector index matches S3.

Prefer the browser for library rename/delete/drag-move (that is the feature users touch). Use `bin/files` to prove the S3 side effect. Use `bin/retrieve` to prove auto-ingest remapped or dropped the key. `/wiki/ask` is the same retrieve plus a streamed answer — do not poll it.

### Auth (always)

```bash
COOKIE=$(.cursor/skills/verify-context101/bin/auth-cookie)
```

In Chrome DevTools, skip `/login` if the agent browser cannot render the WebGL login shell (Next then shows "This page couldn't load"). Instead:

1. `emulate` `extraHttpHeaders` to `{"Cookie":"<cookie>"}`.
2. `navigate_page` to `http://localhost:3000/knowledge`.

Stable handles:

| Control | Handle |
| --- | --- |
| Knowledge nav | link `Knowledge` → `/knowledge` |
| Wiki nav | link `Wiki` → `/wiki` |
| Brains nav | link `Brains` → `/brains` |
| New file | button `New file` |
| New folder | button `New folder` |
| Add source | button `Add source` → dialog `Add a source` |
| Library tree | tree `Tree View` |
| File row | treeitem named the filename (e.g. `verify-e2e.md`); `data-tree-key` is the S3 key |
| Folder row | treeitem named the folder (`Uploaded Files` is the virtual root, `data-tree-key=""`) |
| File context menu | menuitem `Open`, `Open in new tab`, `Rename`, `Delete` |
| Folder context menu | menuitem `Rename`, `Delete` |
| Rename dialog | dialog `Rename file` / `Rename folder` |
| Delete dialog | alertdialog `Delete file?` / `Delete folder?` |
| Create dialog | dialog `New file` / `New folder` |

Right-click is not a Chrome DevTools `click` option. Dispatch `contextmenu` on `[data-slot="tree-view-item"]` (files) or `[data-slot="tree-view-branch-control"]` (folders) via `evaluate_script`, then `click` the menuitem.

Library files are draggable. Drop onto a folder row to move into that folder, or onto **Uploaded Files** / a parent folder to move out. Chrome DevTools MCP cannot drag; use a real mouse (computer-use). Do not drop namespaced verify files onto Uploaded Files (that writes the basename at library root).

Isolation: every mutating run uses a unique prefix `verify/<run-id>/` (example: `verify/20260903-2100/e2e.md`). Never rename or delete existing library files. Do not drive the user's unsaved editor state.

The default brain is `default` (cookie `ctx_brain` / query `?brain=`). Stay on Default unless the feature file says otherwise.

### HTTP helper

```bash
.cursor/skills/verify-context101/bin/files list ""
.cursor/skills/verify-context101/bin/files put "verify/RUN/e2e.md" "# hello"
.cursor/skills/verify-context101/bin/files get "verify/RUN/e2e.md"
.cursor/skills/verify-context101/bin/files move "verify/RUN/e2e.md" "verify/RUN/e2e-renamed.md"
.cursor/skills/verify-context101/bin/files delete "verify/RUN/e2e-renamed.md"
.cursor/skills/verify-context101/bin/files delete "verify/RUN/" --folder
```

A successful `put`/`move`/`delete` JSON includes `"ok": true`. `list` after move must show the new name and not the old one.

```bash
.cursor/skills/verify-context101/bin/retrieve "Where does the purple lantern moth nest CANARY"
.cursor/skills/verify-context101/bin/retrieve --expect-key "verify/RUN/e2e.md" --canary "CANARY" --timeout 480 "Where does the purple lantern moth nest CANARY"
.cursor/skills/verify-context101/bin/retrieve --expect-key "verify/RUN/e2e-renamed.md" --absent-key "verify/RUN/e2e.md" --canary "CANARY" --timeout 480 "Where does the purple lantern moth nest CANARY"
.cursor/skills/verify-context101/bin/retrieve --absent-key "verify/RUN/e2e-renamed.md" --absent-canary "CANARY" --timeout 480 "Where does the purple lantern moth nest CANARY"
```

A wait returns `"ok": true` when the key/canary condition holds. Default timeout is 480s (ingest is a full KB sync and may queue behind an in-flight job).

## Evidence

Write proof under `.cursor/skills/verify-context101/artifacts/<feature>/`. That directory is gitignored. Cleanup must not delete it.

Standards:

- Exercise `/knowledge` (or the mapped UI) and `/api/files/*`. Do not call S3 from the agent as the primary proof — the app's file API is the user boundary.
- Capture the action and the resulting state: screenshot or ARIA snapshot of the tree **before**, the dialog/menu **during**, and the tree **after**.
- Confirm the S3 side effect with `bin/files list` / `bin/files get` after each mutation.
- Confirm the vector-index side effect with `bin/retrieve` after create, rename, move, and delete (see [library-ingest](features/library-ingest.md)). A list/get pass is not enough for ingest.
- Mocks are not allowed for this skill's happy path. If S3 is unreachable, doctor fails and the run stops. If retrieve returns `this brain has no knowledge base yet`, stop.

Keep proof under `artifacts/<feature>/` (gitignored). Do not commit screenshots of a real library.

## Cleanup

```bash
.cursor/skills/verify-context101/bin/cleanup
```

Deletes the `verify/<run-id>/` prefix recorded in `/tmp/verify-context101-run.id` (if present), any keys listed in `/tmp/verify-context101-extra-keys` (root-level UI files), and stops a Next.js process **only if this skill's `launch` wrote `/tmp/verify-context101-next.pid`**. It never kills the environment-started server on `:3000`.

Evidence in `artifacts/` stays.

## Helpers

All executable; invoke from the repo root:

| Script | Purpose |
| --- | --- |
| `bin/aws-env` | `source` to export AWS creds (no stdout secrets) |
| `bin/auth-cookie` | print `name=value` session cookie |
| `bin/doctor` | read-only health check |
| `bin/launch` | reuse or start `:3000` with AWS env |
| `bin/files` | authenticated list/get/put/move/delete |
| `bin/retrieve` | Bedrock Retrieve via `/api/wiki/retrieve`; can wait on a key/canary |
| `bin/cleanup` | remove `verify/` scratch keys; stop only our Next |

Feature recipes live in [`features/`](features/README.md).
