# Add source

Add source opens a provider picker from Knowledge (header or sidebar) or the Sources page. Choosing a provider shows that connector’s fields. Submitting creates a real connector and starts OAuth / GitHub install — do not submit in a default verify run.

## Sub-features

- `src-open-header` opens the picker from the Knowledge toolbar **Add source** button.
- `src-open-sidebar` opens the picker from the sidebar **Add source** button under Sources.
- `src-pick-provider` shows a provider’s params form (Google Docs / Sheets / Slides, Notion, GitHub) without submitting.
- `src-mobile-drawer` below the `md` breakpoint renders the picker as a bottom sheet, not a centered dialog.

## How to get to it (user POV)

- Knowledge header: button `Add source` (desktop) or `aria-label="Add source"` (icon on small viewports).
- Knowledge sidebar Sources: button `Add source`.
- Sources page: **Add new source**.

## Driving it with Chrome DevTools

Preconditions:

- Doctor healthy. Cookie injected. `/knowledge` on Default.
- Do not fill a URL and click Connect.

- **Open.** Click button `Add source`. Dialog `Add a source` lists Google Docs, Google Sheets, Google Slides, Notion, GitHub.
- **Provider.** Click `Google Docs` (or another listed provider). Title becomes `Add a Google Doc` (or that provider’s copy). A Back control returns to the picker.
- **Close.** Dismiss with the dialog close control. No connector is created.
- **Proof.** Screenshot `artifacts/add-source/01-picker.png` with `Add a source` visible. Optional: `02-params.png` on a provider form with empty fields.

## Gotchas

- Submitting starts OAuth or a GitHub App install and writes a connector row. Default verify stops at the empty form.
- On viewports below `md`, the same dialog is a bottom drawer (swipe-to-dismiss on the grabber). Desktop is a centered dialog.
- The picker stays mounted outside the brain status gate so the header button works while a brain is loading.
- GitHub shows a PAT field only when the GitHub App is not configured.
