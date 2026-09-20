# Add source

Add source opens a provider picker from Knowledge (header or sidebar) or the Sources page. Choosing a provider shows that connector’s fields. Submitting creates a real connector and starts OAuth / GitHub install — do not submit in a default verify run. The v0 connector contract (auth / sync / S3 / retrieve canary) is [connector-contract](./connector-contract.md).

Google is **one row** (not Docs / Sheets / Slides). The form is **Add a Google file**: Drive picker when configured, paste-URL otherwise. **Paste is the default verify path.** GitHub’s form is the App / repo-picker / PAT-fallback — [github-source](./github-source.md). Notion is still label + URL.

## Sub-features

- `src-open-header` opens the picker from the Knowledge toolbar **Add source** button.
- `src-open-sidebar` opens the picker from the sidebar **Add source** button under Sources.
- `src-pick-files` shows the **Upload files** drop zone / file picker without uploading.
- `src-pick-google` shows **Add a Google file** without submitting. Default: paste fallback. Live Drive picker is optional/skip.
- `src-pick-provider` shows a provider’s params form (Google, Notion, GitHub) without submitting.
- `src-mobile-drawer` below the `md` breakpoint renders the picker as a bottom sheet, not a centered dialog.
- `src-github` is the GitHub-specific form — [github-source](./github-source.md).

## How to get to it (user POV)

- Knowledge header (desktop `sm+`): button `Add source`.
- Knowledge header (narrow): button `Knowledge actions` → menuitem `Add source`.
- Knowledge sidebar Sources: button `Add source`.
- Sources page: heading **Data sources**, toolbar **Add new source** (narrow: **Add**), or a sidebar row (**Upload files**, **Google**, **Notion**, **GitHub**). There are no Docs / Sheets / Slides picker rows. Knowledge sidebar synced trees still group under Google as Docs / Sheets / Slides.

## Driving it with Chrome DevTools

Preconditions:

- Doctor healthy for HTTP + session (S3 is not required to open the picker). Cookie injected. `/knowledge` on Default.
- Do not fill-and-submit. Do not click **Connect Google account**, **Browse Google Drive**, **Add Google file**, **Connect GitHub**, **Add repository**, or **configure the shared GitHub App**.

- **Open.** Click button `Add source`. Dialog heading `Add a source` lists buttons `Upload files`, `Google`, `Notion`, `GitHub` (four rows). Proof: screenshot `artifacts/add-source/01-picker.png`.
- **Upload files.** Click `Upload files`. Heading becomes `Upload files`. The form is a drop zone (`Drop .md files here, or click to choose`). Do not pick or drop files in a default run (root keys need `/tmp/verify-context101-extra-keys`). Back control is button `Back to source types`.
- **Config (HTTP).** `GET /api/connectors/google/picker-config` with the session cookie. Record only `oauthConfigured` and `pickerConfigured` (booleans). Do not save `clientId` / `apiKey` / `appId` into artifacts. Local Cloud Agent instances are often `{ oauthConfigured: false, pickerConfigured: false }`. Hosted admin may be `pickerConfigured: true`.
- **Provider (Google) — default, paste fallback.** Click `Google`. Wait until “Checking your Google access…” is gone. Heading is `Add a Google file`. **Safe default:** use summary `Or paste a link` (open it if collapsed). Fields: **Label** `(editable)` and a URL. Optional, still no submit: paste `https://docs.google.com/document/d/example/edit` — label becomes `Google Docs` and the hint reads “This will connect as **Docs**” (Sheets / Slides URLs infer those types). Footer `Connect Google account` enables once label + URL + type are set — do not click it. Back is `Back to source types`. When `pickerConfigured` is false, paste is already open and there is no body Drive button; description is the paste copy. Proof: `artifacts/add-source/02-google-paste.png`.
- **Provider (Google) — Drive picker (optional / skip).** When `pickerConfigured` is true, description is “Connect Google, then pick a Doc, Sheet, or Slides deck…”, and a full-width `Connect Google account` sits above Label (becomes `Browse Google Drive` after a session). That opens GIS + Google Picker (`Select a Google file`). After a pick, footer becomes `Add Google file`. **Skip** when `pickerConfigured` is false, scripts fail to load, or the agent cannot complete GIS. Do not click Connect / Browse / Add. Paste remains the verify path — expand `Or paste a link` if it is collapsed.
- **Provider (Notion).** Click `Notion`. Heading becomes `Add a Notion page or database`. Fields are **Label** and the URL. Footer `Connect Notion workspace`. Back is `Back to source types`.
- **Provider (GitHub).** Click `GitHub`. Heading becomes `Add a GitHub repository`. The fields depend on `GET /api/connectors/github-app` — see [github-source](./github-source.md). Driven path when `configured` is false: Connection name, Repository URL, Personal access token, optional Paths to sync; **Add repository** stays disabled.
- **Close.** Button `Close` (sr-only on the X) or **Cancel**. No connector is created.

## Gotchas

- Submitting writes a connector row and starts OAuth / GitHub install. Default verify stops at the empty (or status-loaded) form.
- `google` is a picker kind only. Create still writes `docs` | `sheets` | `slides`. There is no `drive` `source_type`.
- On viewports below `md`, the same dialog is a bottom drawer (swipe-to-dismiss on the grabber). Desktop is a centered dialog. A picked Google file shows name + `resource_url` under the Drive button; both truncate with ellipsis (`min-w-0` / `overflow-hidden`). A long Docs URL must not widen the sheet or create horizontal scroll. Do not submit **Add Google file** after a pick.
- The picker stays mounted outside the brain status gate so the header button works while a brain is loading.
- When `oauthConfigured` is false, a note says instance admins can run `context101 connectors setup google`. Paste still shows; do not treat that as a live picker. When `pickerConfigured` is true, do not treat the body `Connect Google account` as the default verify control.
- GitHub is not “paste URL + PAT” first anymore. PAT appears when the instance has no GitHub App, the user chooses **Use a personal access token instead**, or app access fails. When the App is configured for this org, the primary control is **Connect GitHub** or a repository combobox.
