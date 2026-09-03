# Library ingest

Library ingest is the Bedrock knowledge-base side effect of creating, renaming, or deleting an uploaded file. S3 events start an ingestion job; the vector index then ranks the new key, drops the old key, and forgets deleted text.

## Sub-features

- `ingest-after-create` retrieves a unique canary from the new S3 key after put.
- `ingest-after-rename` retrieves the same canary from the renamed key and not the old key.
- `ingest-after-delete` no longer retrieves the canary or either key.
- `ingest-ask-ui` asks the same question on `/wiki/ask` and shows the source key in Retrieved context.

## How to get to it (user POV)

- Create, rename, or delete a Library file (see [library-files](./library-files.md)).
- Open **Ask the brain** (`/wiki/ask`) and submit a question. Retrieved context lists S3 keys and scores.
- Call `POST /api/wiki/retrieve` with `{ "message": "…" }` while signed in. This is the same Bedrock Retrieve as `/api/wiki/chat` without the Claude answer.

## Driving it with bin/files + bin/retrieve

Preconditions:

- Doctor is healthy. Default brain is `ready` and has a knowledge base.
- `RUN=verify/<timestamp>/` is unused and written to `/tmp/verify-context101-run.id`.
- Pick a canary token that cannot appear in existing docs (example: `ZX9Q-VERIFY-CANARY-<timestamp>`).
- File body includes the canary plus a distinctive sentence so Retrieve has something to embed.

- **Create.** `bin/files put "${RUN}e2e.md" "# Vector ingest probe\n\nUnique token: <CANARY>\nThe purple lantern moth nests in quartz libraries.\n"`. List shows `e2e.md`.
- **Wait until indexed.** `bin/retrieve --expect-key "${RUN}e2e.md" --canary "<CANARY>" --timeout 480 "Where does the purple lantern moth nest <CANARY>"`. Proof JSON has `"ok": true` and `matched_expect` contains that key. Save as `artifacts/library-ingest/01-after-create.json`.
- **Rename.** `bin/files move "${RUN}e2e.md" "${RUN}e2e-renamed.md"` (or the Knowledge context menu). List shows only the new name.
- **Wait until remapped.** `bin/retrieve --expect-key "${RUN}e2e-renamed.md" --absent-key "${RUN}e2e.md" --canary "<CANARY>" --timeout 480 "Where does the purple lantern moth nest <CANARY>"`. Save `artifacts/library-ingest/02-after-rename.json`.
- **Delete.** `bin/files delete "${RUN}e2e-renamed.md"` (or the Delete dialog).
- **Wait until dropped.** `bin/retrieve --absent-key "${RUN}e2e-renamed.md" --absent-canary "<CANARY>" --timeout 480 "Where does the purple lantern moth nest <CANARY>"`. Save `artifacts/library-ingest/03-after-delete.json`.
- **Ask UI (optional).** After create (or rename) is indexed, open `/wiki/ask`. Fill textbox `Ask this brain` with the same query. Submit (Enter or the send button). Expand `Retrieved context`. The source key matches the current filename. Screenshot `artifacts/library-ingest/ask.png`.

## Gotchas

- Auto-ingest is a full KB sync, not a per-file embed. A job already running returns `ConflictException` and the next sync picks up the new keys. Budget 1–8 minutes; do not treat a 15s miss as failure.
- Wiki pages are not regenerated. Only the vector index changes. Do not use `/wiki` page text as ingest proof.
- `/api/wiki/chat` also retrieves, then calls Claude. Prefer `/api/wiki/retrieve` when polling so a wait loop does not spend inference.
- Proof JSON lists source keys and canary hit counts only. Do not save other documents' passage text.
- Retrieve ranks by similarity. The query must include the canary (or the distinctive sentence). A generic "test file" query will miss.
- Default filter excludes `source=github` and `source=code-wiki`. Manual uploads have no `source` sidecar and are included.
- If retrieve returns `this brain has no knowledge base yet`, stop. There is nothing to wait for.
