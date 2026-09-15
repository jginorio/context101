---
name: verify-context101
description: Drive Context101's two verification surfaces — the Next.js admin (Knowledge library, sources, brains) and the self-host CLI (context101-cli / bin context101). Use when verifying create/rename/move/delete, login, brains, or CLI help/list/destroy --dry-run against a real app or AWS account. Wiki and Conflicts are parked.
---

# Verify Context101

Context101 has two verification surfaces:

1. **Next.js admin** in `web/` (Knowledge library, suggestions, sources, brains) at `:3000`. Wiki and Conflicts are parked.
2. **Self-host CLI** in `packages/cli` — npm package `context101-cli`, bin `context101` — the AWS front door for stack ops (`help` / `list` / `help urls` / `destroy --dry-run` in a default run).

The MCP server and marketing remain out of scope here.

Agents that have never seen this repo should follow this file cold. For admin features: launch or reuse `:3000`, run doctor, drive a mapped feature through the real UI or the authenticated file APIs, capture proof, then clean up scratch keys only. For CLI features: use a fresh shell session per command, doctor the `context101` bin (or `npx -y context101-cli@0.1.2`), drive help / list / destroy --dry-run, and capture stdout under `artifacts/cli/`. Wiki and Conflicts are parked on main — do not expect those nav items.

## Launch

### Admin (:3000)

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

### CLI (fresh session per command)

`list`, `help`, `help urls`, and `destroy --dry-run` need no repo checkout. Use a new short-lived shell for each command — this is not the long-lived admin on `:3000`.

Doctor: `which context101` or `npx -y context101-cli@0.1.2`. `context101 help` exits 0.

Drive via `bin/cli` when present, or bare `context101`. Capture stdout under `artifacts/cli/`. Never deploy, and never destroy without `--dry-run`, in this skill's default run. See [features/cli.md](features/cli.md).

```bash
.cursor/skills/verify-context101/bin/cli help
.cursor/skills/verify-context101/bin/cli help list
.cursor/skills/verify-context101/bin/cli help urls
.cursor/skills/verify-context101/bin/cli list --aws-profile <name>
.cursor/skills/verify-context101/bin/cli destroy <space-or-stack> --dry-run --aws-profile <name>
```

Omit `--aws-profile` when the default AWS env is already the right account. `plateapr.com` is a live-stack example, not a required profile. `list` / `destroy --dry-run` also need the `aws` CLI on PATH. Unscoped `npx context101` is Context7's MCP — use `context101-cli`. Never print deploy-env secrets or AWS keys.

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

Prefer the browser for library rename/delete/drag-move (that is the feature users touch). Use `bin/files` to prove the S3 side effect. Use `bin/retrieve` to prove auto-ingest remapped or dropped the key. Wiki chrome is parked; do not poll `/wiki/ask`.

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
| Wiki nav | parked. No Wiki link. `/wiki` and `/wiki/*` redirect to `/knowledge`. Settings has no wiki model or Wiki regeneration |
| Suggestions nav | link `Suggestions` → `/suggestions` |
| Conflicts nav | parked. No Conflicts link. `/conflicts` redirects to `/knowledge` |
| App nav strip | sidebar row under Active brain: Knowledge, Suggestions, Sources, Brains |
| Sources nav | link `Sources` → `/sources` (heading `Data sources`) |
| Brains nav | link `Brains` → `/brains` |
| New brain | button `New brain` (do not submit in a default run) |
| Brain Advanced | button `Advanced` / `aria-label="Advanced settings"` on a ready row (opens `/settings`) |
| Delete brain | icon button `aria-label="Delete brain"` on a non-default row; while `deleting` the label is `Retry delete`. Dialog title `Delete brain "{name}"?`. Type the display name; footer button `Delete brain`. Never use in a default run |
| Brain error gate | heading `Brain failed to provision`; button `Delete & retry` goes to `/brains` (do not delete) |
| Brain empty gate | heading `No brains yet`; primary button `Create a brain` → `/brains?new=1` (opens `Create a brain` dialog; do not submit). Header switcher matches: hint `No brains yet`, label `Create a brain`, aria `No brains yet. Create a brain` — never `Active brain: default`. New self-host has zero brains — do not expect a `default` row |
| Brain stale gate | heading `Brain not found` + “registered under …”; outline button `Pick another brain` → `/brains`. Only when the catalog has other brains but this id 404s |
| First-run setup | `/setup` — heading `Set up Context101`, card `Create first admin`. Redirects to `/login` when an org already exists. Skip on a shared instance |
| Login magic link | `/login` — button `Email me a sign-in link` (do not submit in a default run) |
| New file | button `New file` |
| New folder | button `New folder` |
| Add source | button `Add source` → dialog `Add a source` |
| Upload files | button `Upload files` in the picker → dialog title `Upload files` |
| GitHub provider | button `GitHub` → dialog title `Add a GitHub repository` |
| Back to types | button `Back to source types` |
| Connect GitHub | button `Connect GitHub` → `/api/connectors/github-app/install` (do not click in a default run) |
| Add repository | button `Add repository` (do not submit in a default run) |
| Library tree | tree `Tree View` |
| File row | treeitem named the filename (e.g. `verify-e2e.md`); `data-tree-key` is the S3 key |
| Folder row | treeitem named the folder (`Uploaded Files` is the virtual root, `data-tree-key=""`). The Library / Uploaded Files section is omitted when the brain has no uploaded files. Browse-mode source trees (GitHub, Docs, …) join empty parent folders into one row (`apps/plateapr.com/docs`); `data-tree-key` is the deepest folder prefix |
| File context menu | menuitem `Open`, `Open in new tab`, `Rename`, `Delete` |
| Folder context menu | menuitem `Rename`, `Delete` |
| Rename editor | inline textbox `[data-slot="tree-view-node-rename-input"]` on the row (no dialog); Enter or blur saves, Escape cancels |
| Delete dialog | alertdialog `Delete file?` / `Delete folder?` |
| Create dialog | dialog `New file` / `New folder` |

Right-click is not a Chrome DevTools `click` option. Dispatch `contextmenu` on `[data-slot="tree-view-item"]` (files) or `[data-slot="tree-view-branch-control"]` (folders) via `evaluate_script`, then `click` the menuitem.

Library files are draggable. Drop onto a folder row to move into that folder, or onto **Uploaded Files** / a parent folder to move out. Chrome DevTools MCP cannot drag; use a real mouse (computer-use). Do not drop namespaced verify files onto Uploaded Files (that writes the basename at library root).

Isolation: every mutating run uses a unique prefix `verify/<run-id>/` (example: `verify/20260903-2100/e2e.md`). Never rename or delete existing library files. Do not drive the user's unsaved editor state.

Cookie `ctx_brain` / query `?brain=` empty means no brain is selected. That id is not auto-seeded — a new stack has no brains. Knowledge shows the empty gate and the header says `No brains yet` / `Create a brain` (never `Active brain: default`). Shared verify instances usually already have a ready brain; with no cookie the client picks the first ready one. Stay on that brain unless the feature file says otherwise.

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
| `bin/cli` | forward to `context101` (or `npx -y context101-cli@0.1.2`) |
| `bin/files` | authenticated list/get/put/move/delete |
| `bin/retrieve` | Bedrock Retrieve via `/api/wiki/retrieve`; can wait on a key/canary |
| `bin/cleanup` | remove `verify/` scratch keys; stop only our Next |

Feature recipes live in [`features/`](features/README.md).
