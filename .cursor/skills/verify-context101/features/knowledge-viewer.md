# Knowledge viewer

Knowledge viewer opens an uploaded or connected file in a tab, previews markdown, and lets the user edit and save non-connector files.

## Sub-features

- `view-open` opens a file from the tree into a tab.
- `view-preview` shows the Preview tab for `.md`.
- `view-edit-save` edits and saves an uploaded file.
- `view-delete` deletes the open file from the viewer trash button.
- `view-readonly` shows connector-managed files as read-only.

## How to get to it (user POV)

- Click a file treeitem under Library or Sources.
- Right-click a file and choose Open or Open in new tab.
- Open `/knowledge?open=<key>`.

## Driving it with Chrome DevTools + bin/files

Preconditions:

- Doctor is healthy. Cookie injected. `/knowledge` on Default.
- A disposable file `${RUN}view.md` exists (`bin/files put`).

- **Open.** Click treeitem `view.md`. A tablist `Open documents` appears with that file. The viewer header shows the key in a monospace line.
- **Preview.** Tabs `Preview` / `Raw` are present. Preview renders the markdown body.
- **Edit.** Click button `Edit`. A textarea shows the raw content. Change it and click `Save`. Toast `Saved`. `bin/files get "${RUN}view.md"` returns the new body.
- **Viewer delete.** Click the trash button (destructive ghost). Alertdialog `Delete file?`. Confirm. The tab closes.
- **Proof.** Screenshot `artifacts/knowledge-viewer/open.png` with the file tab and preview visible. Keep the get/list JSON.

## Gotchas

- Files under `sources/` are connector-managed: Edit/Improve/Delete are hidden.
- Empty state copy is `Select a file to view` when no tab is active.
- Deep-link `?open=` is stripped from the URL after tabs open.
