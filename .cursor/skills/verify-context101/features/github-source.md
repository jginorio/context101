# GitHub source

GitHub is no longer “paste a repo URL and a PAT, then sync.” The hosted path is an org-scoped GitHub App: the user connects GitHub (install + user OAuth), then picks a granted repository from a combobox. A personal access token is only the fallback when this instance has no GitHub App, the user opts out, or app access fails.

Submitting **Add repository** or **Connect GitHub** writes a connector and/or starts GitHub’s install/OAuth. Do not submit or start install in a default verify run.

## Sub-features

- `gh-status` reads `GET /api/connectors/github-app` (`configured`, and when configured `installed` + `installations`).
- `gh-form-pat` (driven) — app not configured: Connection name, Repository URL, Personal access token, optional Paths to sync. Primary button is **Add repository** (disabled until those three fields are filled).
- `gh-form-connect` (code-guaranteed; not driven here) — app configured, this org has no installation: primary button is **Connect GitHub** and navigates to `/api/connectors/github-app/install`.
- `gh-form-repos` (code-guaranteed; not driven here) — app configured and this org has an installation: Repository combobox (`Search repositories…`), editable Connection name, optional Paths to sync, **Add repository**. Links: **Manage repository access**, **Connect another account**.
- `gh-origin` — Amplify-style `Host` / `x-forwarded-host: localhost:3000` on `/sources`, `/api/connectors/github-app/oauth-callback`, and `/api/connectors/github-app/install` must 307 to the configured public origin, not localhost.
- `gh-toasts` (code-guaranteed) — `/sources?githubapp=` values surface sonner toasts. Do not fabricate these by editing the URL in a default run.

## How to get to it (user POV)

- Knowledge: **Add source** → **GitHub** (same picker as [add-source](./add-source.md)).
- Sources (`/sources`): heading **Data sources**, toolbar **Add new source**, or the sidebar **GitHub** row.

## Driving it with Chrome DevTools + HTTP

Preconditions:

- Doctor as far as HTTP + session. S3 is not required to open the form.
- Cookie injected. Start from `/knowledge` on Default, or `/sources`.
- Do not click **Connect GitHub**, **configure the shared GitHub App**, **Add repository**, or **Connect another account**.

- **Status.** `GET /api/connectors/github-app` with the session cookie. `{ "configured": false }` means the PAT form. `{ "configured": true, "installed": false }` means **Connect GitHub**. `{ "configured": true, "installed": true }` means the repo combobox (then `GET /api/connectors/github-app/repositories`).
- **Open PAT form (driven when `configured` is false).** Click **Add source** → **GitHub**. Wait until “Checking your GitHub access…” is gone. Dialog title is **Add a GitHub repository**. Visible: Connection name, Repository URL, Personal access token, Paths to sync (optional), note that a PAT is required, link **configure the shared GitHub App**. **Add repository** is disabled. Back control is button `Back to source types`.
- **Close.** Dialog **Close** or **Cancel**. No connector row is created.
- **Origin (HTTP, no browser GitHub).** `GET` the install and OAuth-callback routes with `Host: localhost:3000`, `x-forwarded-host: localhost:3000`, `x-forwarded-proto: https`. The `Location` host must not be localhost (uses `APP_URL` / `BETTER_AUTH_URL` when Amplify lies). Unauthenticated hits go to `/login`; authenticated callback without `code`/`state` goes to `/sources?githubapp=…`.
- **Proof.** Screenshot `artifacts/add-source/02-github-params.png` (or `artifacts/github-source/01-form.png`) with **Add a GitHub repository** visible. HTTP log `artifacts/add-source/03-origin-redirects.log` with `location_has_localhost=False`.

## Gotchas

- Default verify **stops before** GitHub’s install or OAuth screens. Those bind an installation to the signed-in org.
- After GitHub auth, the app must send the browser to the public `/sources`, not `https://localhost:3000/sources`. Swapping the host on an already-failed callback only replays `?githubapp=`; start **Connect GitHub** again from Data sources.
- `githubapp=permission_denied` toast: “GitHub did not grant access to that installation. Give the Context101 app permission or use a personal access token.” Other query values: `installed`, `created`, `already_configured`, `not_configured`, `not_authenticated`, `invalid_state`, `start_in_context101`, `error`.
- Hosted `BETTER_AUTH_URL` still rejects browser `fetch` from `http://localhost:3000` (`INVALID_ORIGIN`). Use `bin/auth-cookie`.
- `GET /api/connectors/github-app/create` is instance-admin manifest setup and is often disabled in production. Do not open it in a default run.
- Connector rows already on `/sources` are shared tenant data. Do not **Sync now** or delete them in a default run.
