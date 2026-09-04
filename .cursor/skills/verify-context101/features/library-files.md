# Library files

Library files lets a user create, rename, move, and delete markdown files and folders under Uploaded Files. Those writes go to the active brain's S3 docs bucket through `/api/files/*`.

## Sub-features

- `lib-create-file` creates a `.md` file from the toolbar New file dialog.
- `lib-create-folder` creates a folder from New folder (S3 key `name/.keep`).
- `lib-rename-file` renames a file from the tree context menu.
- `lib-rename-folder` renames a real folder (not the Uploaded Files root).
- `lib-move-file` drags a library `.md` file onto a folder (or onto Uploaded Files / a parent folder to move it out).
- `lib-upload-drop` drops one or more OS `.md` files onto a folder, a file row (parent folder), or the empty viewer.
- `lib-delete-file` deletes a file after a confirmation dialog.
- `lib-delete-folder` deletes a folder recursively after confirmation.
- `lib-http` performs the same mutations through `bin/files`.
- `lib-ingest` is the vector-index follow-up — see [library-ingest](./library-ingest.md). A list/get pass alone does not prove Bedrock ingested the new key.

## How to get to it (user POV)

- Open Knowledge (`/knowledge`), Library → Uploaded Files.
- Choose `New file` or `New folder` in the page toolbar (or the Library `…` menu).
- Right-click a file or folder row in the tree and choose Rename or Delete.
- Drag a library file onto a folder row (into that folder) or onto **Uploaded Files** / a parent folder (out of the current folder).
- Drop `.md` files from the OS onto a folder, a file row, or the empty viewer.
- Call `POST /api/files/put`, `/move`, `/delete` while signed in.

## Driving it with Chrome DevTools + bin/files

Preconditions:

- Doctor is healthy at `http://localhost:3000`.
- Cookie injected; page is `/knowledge` on Default.
- `RUN=verify/<timestamp>/` is unused. Write `$RUN` to `/tmp/verify-context101-run.id`.

- **Create file (UI).** Choose `New file`. Click button `New file`. Dialog `New file` opens. Fill the textbox with `verify-e2e.md` if creating at root, or use HTTP for a namespaced key (the dialog always creates under the parent prefix; toolbar uses root). Prefer HTTP for isolation: `bin/files put "${RUN}e2e.md" "# verify e2e"`. If you do create at root, append the key to `/tmp/verify-context101-extra-keys` so cleanup can delete it. Toast `File created` or JSON `"ok": true`. `bin/files list "$RUN"` contains `e2e.md`.
- **Create file proof.** `bin/files get "${RUN}e2e.md"` returns content `# verify e2e`. Screenshot the tree showing `e2e.md` at `artifacts/library-files/01-created.png`.
- **Rename file (UI).** Dispatch `contextmenu` on the treeitem `e2e.md`. Menu includes `Rename` and `Delete`. Click `Rename`. Dialog `Rename file` shows key `${RUN}e2e.md`. Fill the textbox with `e2e-renamed.md` and click `Rename`. Toast `Renamed`.
- **Rename file proof.** `bin/files list "$RUN"` contains `e2e-renamed.md` and not `e2e.md`. `bin/files get "${RUN}e2e-renamed.md"` still has `# verify e2e`. Screenshot `artifacts/library-files/02-renamed.png`.
- **Delete file (UI).** Context-menu `e2e-renamed.md` → `Delete`. Alertdialog `Delete file?` shows the key. Click `Delete`. Toast `File deleted`.
- **Delete file proof.** `bin/files list "$RUN"` no longer lists `e2e-renamed.md`. Screenshot `artifacts/library-files/03-deleted.png`.
- **HTTP entry.** Repeat create → move → delete with `bin/files put|move|delete` on `${RUN}http.md` → `${RUN}http-renamed.md`. Each JSON has `"ok": true`.
- **Move file (UI).** Seed `${RUN}inbox.md` and `${RUN}dest/.keep` via `bin/files put`. Refresh / reload `/knowledge` so both appear. Drag treeitem `inbox.md` onto folder `dest`. Toast `Moved inbox.md`. The file is gone from `${RUN}` and present as `${RUN}dest/inbox.md`.
- **Move file out (UI).** Drag `inbox.md` from `dest` onto folder `RUN` (the namespaced parent — not Uploaded Files). Toast `Moved inbox.md`. List shows `${RUN}inbox.md` again and not `${RUN}dest/inbox.md`. Screenshot `artifacts/library-files/04-moved.png` with the file back under the run folder.
- **Move file proof.** `bin/files list` after each drop shows the new key and not the old one. `bin/files get` still has the original body.
- **Upload drop (optional).** Prefer `bin/files put` for isolation. If you do drive an OS drop, the target is a folder under `$RUN` (or a file row in that folder). Toast `Uploaded <name>.` or `Uploaded N files.` Do not drop onto Uploaded Files in a default run (root keys need `/tmp/verify-context101-extra-keys`).
- **Folder (optional).** `bin/files put "${RUN}dir/.keep" ""`, rename via UI or `bin/files move "${RUN}dir/" "${RUN}dir-renamed/"`, delete with `bin/files delete "${RUN}dir-renamed/" --folder`.

## Gotchas

- Toolbar New file creates at the library root, not under `verify/`. Use `bin/files put` when you need a namespaced key, or create a folder first and use its context (the current UI only namespaces from the Library `…` at root).
- `Uploaded Files` is a virtual root (`prefix=""`). It has no Rename/Delete. Right-clicking it must not open those items.
- Connector rows under Sources are browse-only: Open / Open in new tab, no Rename/Delete, no drag, no drop-to-move.
- Folder keys end with `/`. File keys do not. Move/delete of a folder must use the trailing slash and `recursive: true`.
- List hides `.keep` and `.metadata.json`. An empty folder still exists in S3 after create.
- After rename/move/delete the tree refreshes from `refreshKey`. Wait for the new treeitem name, not a fixed sleep.
- Library files are `draggable` (`cursor-grab`). Drop targets are folder rows (`data-tree-key` / `data-drop-prefix`) and file rows (parent prefix). Same-parent drops are no-ops; a name clash toasts `<name> already exists there`.
- Chrome DevTools MCP has no drag action. Prefer a real mouse drag (computer-use). Synthetic `DragEvent` + `DataTransfer` often arrives empty in Chrome — do not treat a failed synthetic drop as a product bug.
- Do not drag onto **Uploaded Files** in a namespaced verify run: that moves the file to the library root. Drop onto the parent folder instead.
- OS drops use the `Files` MIME and upload; in-app moves use `application/x-context101`. They do not share a handler.
- Browser sign-in from localhost against the hosted `BETTER_AUTH_URL` fails with `INVALID_ORIGIN`. Use `bin/auth-cookie`.
