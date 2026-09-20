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
- **Config (HTTP).** `GET /api/connectors/google/picker-config` with the session cookie. Record only `oauthConfigured` and `pickerConfigured` (booleans). Do not save `clientId` / `apiKey` / `appId` into artifacts.
- **Provider (Google) — default, paste fallback.** Click `Google`. Wait until “Checking your Google access…” is gone. Heading is `Add a Google file`. When `pickerConfigured` is false (typical on this environment), summary `Or paste a link` is **open**, with **Label** `(editable)` and a URL field. Footer primary is `Connect Google account` (disabled until label + a Docs/Sheets/Slides URL). Optional, still no submit: paste `https://docs.google.com/document/d/example/edit` and confirm the hint “This will connect as **Docs**” (Sheets / Slides URLs infer those types). Do not click the footer. Back is `Back to source types`. Proof: `artifacts/add-source/02-google-paste.png`.
- **Provider (Google) — Drive picker (optional / skip).** Only when `pickerConfigured` is true. Primary is `Connect Google account` (no session) or `Browse Google Drive` (session connected). That opens a GIS popup and Google Picker (`Select a Google file`, Docs / Sheets / Slides tabs). After a pick, label comes from the file name; footer becomes `Add Google file`. **Skip this path** when `pickerConfigured` is false, scripts fail to load, or the agent cannot complete GIS. Code-guaranteed; not required for a default pass. Do not click Connect / Browse / Add.
- **Provider (Notion).** Click `Notion`. Heading becomes `Add a Notion page or database`. Fields are **Label** and the URL. Footer `Connect Notion workspace`. Back is `Back to source types`.
- **Provider (GitHub).** Click `GitHub`. Heading becomes `Add a GitHub repository`. The fields depend on `GET /api/connectors/github-app` — see [github-source](./github-source.md). Driven path when `configured` is false: Connection name, Repository URL, Personal access token, optional Paths to sync; **Add repository** stays disabled.
- **Close.** Button `Close` (sr-only on the X) or **Cancel**. No connector is created.

## Gotchas

- Submitting writes a connector row and starts OAuth / GitHub install. Default verify stops at the empty (or status-loaded) form.
- `google` is a picker kind only. Create still writes `docs` | `sheets` | `slides`. There is no `drive` `source_type`.
- On viewports below `md`, the same dialog is a bottom drawer (swipe-to-dismiss on the grabber). Desktop is a centered dialog.
- The picker stays mounted outside the brain status gate so the header button works while a brain is loading.
- When `oauthConfigured` is false, a note says instance admins can run `context101 connectors setup google`. Paste still shows; do not treat that as a live picker.
- GitHub is not “paste URL + PAT” first anymore. PAT appears when the instance has no GitHub App, the user chooses **Use a personal access token instead**, or app access fails. When the App is configured for this org, the primary control is **Connect GitHub** or a repository combobox.
