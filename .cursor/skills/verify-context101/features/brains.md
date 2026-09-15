# Brains

Brains lets a user see the org's knowledge bases, switch the active brain, and (destructively) create or delete one. Default verification only switches and inspects.

## Sub-features

- `brains-list` shows existing brains on `/brains`.
- `brains-switch` changes the active brain from the sidebar `Active brain` control.
- `brains-create` is a gated path — do not run unless explicitly asked.
- `brains-delete` is a gated path — never delete Default.

## How to get to it (user POV)

- Open `/brains` from the Brains nav link.
- Use the `Active brain: …` button in the sidebar.

## Driving it with Chrome DevTools

Preconditions:

- Doctor healthy. Cookie injected.
- Shared verify instances usually already have a ready brain. A brand-new stack has **no** brains and no `default` row.

- **List.** Navigate to `/brains`. Button `New brain` is visible. When brains exist, a ready row shows status ready. A ready non-default row may show button `Advanced` (`aria-label="Advanced settings"`).
- **Empty stack (code-guaranteed).** Catalog `[]` on Knowledge (and sources / suggestions) shows heading `No brains yet` and primary button `Create a brain` (not “Pick another brain”, not “registered under default”). The sidebar header matches: hint `No brains yet`, label `Create a brain`, aria `No brains yet. Create a brain` — never `Active brain: default`. That link is `/brains?new=1`, which opens the existing `Create a brain` dialog. `/brains` itself still shows `No brains yet` + `Create the first brain`. Do not submit create in a default run.
- **Stale id.** Catalog has other brains but the selected id 404s: heading `Brain not found`, outline `Pick another brain`.
- **Create.** Button `New brain` or `/brains?new=1` opens dialog `Create a brain`. Do not submit.
- **Switch.** On `/knowledge`, click `Active brain: Default. Switch brain` (or the ready brain's name). Choose another ready brain if one exists. The tree refresh key bumps and tabs clear. Switch back before finishing.
- **Delete / retry (code-guaranteed; do not click).** Non-default rows keep an icon button while `error` or `deleting`: `aria-label="Delete brain"` or `aria-label="Retry delete"`. That opens dialog `Delete brain "{display_name}"?`. Confirm by typing the display name; footer button `Delete brain` (becomes `Deleting…`). Default cannot be deleted.
- **Error gate (code-guaranteed; skip unless you land on an errored brain).** Knowledge shows heading `Brain failed to provision` and button `Delete & retry` (links to `/brains`). A `deleting` brain shows heading `Brain is being deleted` with no delete button on that gate.
- **Proof.** Screenshot `artifacts/brains/list.png` with Default visible. Do not capture bearer tokens.

## Gotchas

- Creating a brain invokes BrainProvisionerFn (real AWS). Skip unless the user asked.
- Deleting a brain empties its S3 bucket. Never use delete or retry-delete in a default verify run. The retry control exists so a teardown that failed after status flipped to `deleting` is not stranded.
- Switching brains closes all Knowledge tabs.
