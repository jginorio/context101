# Add source

Add source opens a provider picker from Knowledge (header or sidebar) or the Sources page. Choosing a provider shows that connector’s fields. Submitting creates a real connector and starts OAuth / GitHub install — do not submit in a default verify run. The v0 connector contract (auth / sync / S3 / retrieve canary) is [connector-contract](./connector-contract.md).

Google is one row (Drive picker for Docs / Sheets / Slides, paste-URL fallback). GitHub’s form is the App / repo-picker / PAT-fallback — [github-source](./github-source.md). Notion is still label + URL.

## Sub-features

- `src-open-header` opens the picker from the Knowledge toolbar **Add source** button.
- `src-open-sidebar` opens the picker from the sidebar **Add source** button under Sources.
- `src-pick-files` shows the **Upload files** drop zone / file picker without uploading.
- `src-pick-provider` shows a provider’s params form (Google, Notion, GitHub) without submitting.
- `src-mobile-drawer` below the `md` breakpoint renders the picker as a bottom sheet, not a centered dialog.
- `src-github` is the GitHub-specific form — [github-source](./github-source.md).

## How to get to it (user POV)

- Knowledge header: button `Add source` (desktop) or `aria-label="Add source"` (icon on small viewports).
- Knowledge sidebar Sources: button `Add source`.
- Sources page: heading **Data sources**, toolbar **Add new source**, or a sidebar provider row (**Upload files**, **Google**, **Notion**, **GitHub**).

## Driving it with Chrome DevTools

Preconditions:

- Doctor healthy for HTTP + session (S3 is not required to open the picker). Cookie injected. `/knowledge` on Default.
- Do not fill fields and submit. Do not click **Connect GitHub** or **configure the shared GitHub App**.

- **Open.** Click button `Add source`. Dialog `Add a source` lists Upload files, Google, Notion, GitHub.
- **Upload files.** Click `Upload files`. Title becomes `Upload files`. The form is a drop zone (`Drop .md files here, or click to choose`). Do not pick or drop files in a default run (root keys need `/tmp/verify-context101-extra-keys`). A Back control (`Back to source types`) returns to the picker.
- **Provider (Google).** Click `Google`. Title becomes `Add a Google file`. When `GET /api/connectors/google/picker-config` is `{ pickerConfigured: true }`, primary control is **Connect Google account** / **Browse Google Drive** (do not click — GIS popup + Drive picker). When picker is not configured, **Or paste a link** is open with Label + URL; type is inferred from the URL (`docs` / `sheets` / `slides`). Back control is `Back to source types`.
- **Provider (Notion).** Click `Notion`. Title becomes `Add a Notion page or database`. Fields are **Label** and the URL. A Back control (`Back to source types`) returns to the picker.
- **Provider (GitHub).** Click `GitHub`. Title becomes `Add a GitHub repository`. The fields depend on `GET /api/connectors/github-app` — see [github-source](./github-source.md). Driven path when `configured` is false: Connection name, Repository URL, Personal access token, optional Paths to sync; **Add repository** stays disabled.
- **Close.** Dismiss with the dialog close control or **Cancel**. No connector is created.
- **Proof.** Screenshot `artifacts/add-source/01-picker.png` with `Add a source` visible. Optional: `02-github-params.png` on the GitHub form.

## Gotchas

- Submitting starts OAuth or a GitHub App install and writes a connector row. Default verify stops at the empty (or GitHub status-loaded) form.
- On viewports below `md`, the same dialog is a bottom drawer (swipe-to-dismiss on the grabber). Desktop is a centered dialog.
- The picker stays mounted outside the brain status gate so the header button works while a brain is loading.
- GitHub is not “paste URL + PAT” first anymore. PAT appears when the instance has no GitHub App, the user chooses **Use a personal access token instead**, or app access fails. When the App is configured for this org, the primary control is **Connect GitHub** or a repository combobox.
