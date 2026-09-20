# Connector contract (v0)

Connectors pull an external source into the brain's S3 prefix, then Bedrock Retrieve ranks the new keys. Shipping surface is **sources + retrieve**. Wiki and Conflicts stay parked.

This file is the v0 contract: auth, sync, map to S3+metadata, delete, idempotent, done-when = `bin/retrieve` canary. The TypeScript interfaces live in `web/lib/connectors/contract.ts`. Sync implementations stay in `cdk/lambda/connector-sync-*`. Dispatch is already `cdk/lambda/connector-dispatch` `FN_BY_TYPE`.

Default verify **must not** submit **Connect**, **Add Google file**, **Add repository**, or **Sync now** on a shared brain. The e2e matrix is an **explicit track** (`bin/connector-matrix`, env-gated live GitHub). Open the picker with [add-source](./add-source.md); do not create a row unless this track says so.

Add source shows one **Google** row. The dialog uses Google Picker (when `GOOGLE_PICKER_API_KEY` + `GOOGLE_PICKER_APP_ID`, or `picker_api_key` / `picker_app_id` on the OAuth secret, are set) and maps the chosen MIME type onto `docs` | `sheets` | `slides`. There is no `drive` `source_type`. Paste-URL is the collapsed fallback. A picker session (`drive.file` + the three readonly Workspace APIs) can skip a second OAuth redirect on create; paste-URL without a session still uses the narrower per-type scopes.

## Types

| Kind | Connector row? | S3 prefix |
| --- | --- | --- |
| `docs` | yes | `sources/docs/` |
| `sheets` | yes | `sources/sheets/` |
| `slides` | yes | `sources/slides/` |
| `notion` | yes | `sources/notion/` |
| `github` | yes | `sources/github/` |
| `files` | no — local markdown upload | library root (not `sources/`) |

Prefixes match `web/lib/source-providers.tsx`. `files` is Add source → Upload files, not a connector.

Registry (already half-exists):

```
FN_BY_TYPE = {
  sheets: SHEETS_SYNC_FN_NAME,
  docs:   DOCS_SYNC_FN_NAME,
  slides: SLIDES_SYNC_FN_NAME,
  notion: NOTION_SYNC_FN_NAME,
  github: GITHUB_SYNC_FN_NAME,
}
```

Invoke payload: `{ connectorId, docsBucket, brainId }`.

## Contract

1. **Auth.** Instance OAuth/app clients live in Secrets Manager. Per-connector tokens are separate secrets under `CONNECTOR_TOKEN_SECRET_PREFIX`. See [CLI setup](#self-host-oauth--app-secrets).
2. **Sync.** Per-type Lambda reads the row, fetches upstream, writes markdown + `.metadata.json` sidecar under that type's prefix. Status machine: `pending_auth` → `syncing` → `connected` | `error` (`paused` is operator). UI also shows transient `connecting`.
3. **Map to S3+metadata.** Sidecar `metadataAttributes` always includes `source=<type>` and `connector_id=<uuid>`. GitHub adds `repo`, `path`, `commit_sha`. Notion packs a workspace under one slug; GitHub packs a repo (path-scoped connectors share the repo prefix).
4. **Delete / tombstone.** Remove the connector: drop the row, force-delete its token secret, delete **this connector's** S3 objects (Google: prefix; Notion/GitHub: sidecar `connector_id` match so siblings survive). Bedrock then forgets the text — there is no wiki tombstone page. Proof is retrieve `--absent-key` / `--absent-canary`, same as [library-ingest](./library-ingest.md) delete.
5. **Idempotent.** Re-sync of unchanged bytes is a no-op (GitHub skips blobs whose sidecar `commit_sha` matches). A second sync must not duplicate keys.
6. **Done-when.** `bin/retrieve --expect-key <s3-key> --canary <CANARY>` returns `"ok": true`. List/get on S3 is not enough.

### Per-type auth notes

| Type | Instance secret | Per-connector token |
| --- | --- | --- |
| Google (`docs` / `sheets` / `slides`) | `GOOGLE_OAUTH_CLIENT_SECRET_ID` → `{ client_id, client_secret }` | `{ refresh_token }` — sync mints access_token |
| Notion | `NOTION_OAUTH_CLIENT_SECRET_ID` → `{ client_id, client_secret }` | `{ access_token, workspace_id, workspace_name, bot_id }` — long-lived, no refresh |
| GitHub App | `<CONNECTOR_TOKEN_SECRET_PREFIX>github-app` (`app_id`, `client_id`, `client_secret`, `private_key`) | installation id on the row; sync mints a short-lived token |
| GitHub PAT | none | `{ github_pat }` on the row secret. Fallback when this instance has no App |

Never print secret values, PATs, or `CTX_TOKEN`.

## Status machine

Persisted (`source_status`): `pending_auth` → `syncing` → `connected` | `error` | `paused`. Dispatcher retries `connected` and `error`. `connecting` is UI-only.

## Matrix

Happy / update / delete / bad-token per type. Done-when is retrieve, not the Sources pill.

| Type | happy | update | delete | bad-token |
| --- | --- | --- | --- | --- |
| docs / sheets / slides | OAuth Connect to a fixture with a unique canary → prefix object exists → retrieve ranks it | Change upstream canary, Sync now → retrieve ranks the new canary | Remove connector → retrieve `--absent-key` / `--absent-canary` | Revoked Google token → ERROR accordion; no new key |
| notion | OAuth Connect to a fixture page → `sources/notion/<workspace>/…md` → retrieve | Edit page, Sync now → retrieve new canary | Remove → retrieve absent (siblings in the same workspace stay) | Invalid Notion token → ERROR accordion (`401 unauthorized — API token is invalid.` is the known summary) |
| github | PAT or App on a fixture repo `.md` with canary → `sources/github/<owner>-<repo>/<path>.md` → retrieve | Edit the `.md`, Sync now → retrieve new canary | Remove → retrieve absent (path-scoped siblings on the same repo stay) | Bad PAT / missing installation → ERROR accordion; no new key |

Live OAuth cannot run in CI. **First concrete row: GitHub happy path** (fixture markdown in a test repo + PAT/App — no browser OAuth). Notion OAuth stays documented until secrets exist. Gate live runs with `VERIFY_CONNECTOR_MATRIX=1`.

## Driving the matrix

Preconditions: doctor healthy, dedicated verify brain (not a shared tenant brain), unique canary, `RUN` recorded. Cookie via `bin/auth-cookie`.

Offline (always safe):

```bash
.cursor/skills/verify-context101/bin/connector-matrix --list
.cursor/skills/verify-context101/bin/connector-matrix --type github --row happy
```

Live GitHub happy (explicit; skips without secrets — never prints them):

```bash
VERIFY_CONNECTOR_MATRIX=1 \
VERIFY_GITHUB_REPO=owner/fixture-repo \
VERIFY_GITHUB_PATH=docs/verify-canary.md \
  .cursor/skills/verify-context101/bin/connector-matrix --type github --row happy --live
```

`VERIFY_GITHUB_PAT` (or App install on this org) must already be in the environment. The script never echoes it.

Library-ingest is the template for the GitHub happy row:

1. Connect the fixture repo (PAT form when `GET /api/connectors/github-app` is `{ "configured": false }`, else App picker). Stop on a shared brain.
2. `bin/files list "sources/github/"` until the `.md` key exists.
3. `bin/retrieve --expect-key "sources/github/<slug>/<path>.md" --canary "<CANARY>" --timeout 480 "… <CANARY>"`. Proof JSON `"ok": true`. Save `artifacts/connector-contract/github-happy-01-after-create.json`.
4. Edit the fixture file (new canary), **Sync now**. `bin/retrieve --expect-key … --canary "<NEW>"`. Save `…-02-after-update.json`.
5. Delete this connector. `bin/retrieve --absent-key … --absent-canary "<NEW>"`. Save `…-03-after-delete.json`.

Update / delete / bad-token and the Google/Notion rows follow the table. Do not drive them on shared brains.

## Self-host OAuth / app secrets

Instance clients are **not** in git. CDK references well-known Secrets Manager **names** and injects those names into Amplify as `GOOGLE_OAUTH_CLIENT_SECRET_ID` / `NOTION_OAUTH_CLIENT_SECRET_ID`. GitHub App lives under `CONNECTOR_TOKEN_SECRET_PREFIX`.

Operator flow:

1. Create the provider app (Google Web OAuth client, Notion public integration, or GitHub App). Redirect URI: `https://<admin>/api/connectors/oauth/callback` (GitHub App also needs `/api/connectors/github-app/oauth-callback` + install setup URL). For the Google Drive picker, enable Picker API + Drive API, add the admin origin as an Authorized JavaScript origin, and set `GOOGLE_PICKER_API_KEY` + `GOOGLE_PICKER_APP_ID` (Cloud project number) — or `picker_api_key` / `picker_app_id` on the Google OAuth secret. First Connect asks for `drive.file` plus Docs/Sheets/Slides readonly.
2. `context101 connectors` opens the TTY wizard (pick provider, see configured / not configured, paste credentials or update). `context101 connectors setup google|notion|github` still works for scripts.
3. `context101 update` so Amplify/Lambdas see the names CDK already understands.
4. In admin: **Add source** → **Google** (or Notion / GitHub) → Connect. Do not invent a `drive` connector type.

`cdk/.deploy-env.example` lists the optional keys (names only). `context101 config` redacts secret values; `*_SECRET_ID` keys are names and may be shown. Default verify does not run `connectors` / `connectors setup` (they write AWS). `context101 help connectors` is enough.

## Gotchas

- Default verify stops at the empty form. Submitting writes a tenant connector and starts OAuth / GitHub install.
- Retrieve ranks by similarity. The query must include the canary. Budget 1–8 minutes; auto-ingest is a full KB sync.
- GitHub-synced source-code extensions are dropped after retrieve; `.md` / `.mdx` / `.txt` are included ([library-ingest](./library-ingest.md)).
- Notion and path-scoped GitHub share a prefix with siblings — delete is by `connector_id`, not `rm -rf` the prefix.
- Hosted `BETTER_AUTH_URL` rejects browser `fetch` from `http://localhost:3000`. Use `bin/auth-cookie`.
- Never save other documents' passage text in proof JSON. Never print PATs, OAuth clients, or deploy-env values.
