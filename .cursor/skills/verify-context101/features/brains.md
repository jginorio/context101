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
- At least the Default brain exists and is `ready`.

- **List.** Navigate to `/brains`. Button `New brain` is visible. Default appears as a card/row with status ready. Default has no delete control. A ready non-default row may show button `Advanced` (`aria-label="Advanced settings"`).
- **Switch.** On `/knowledge`, click `Active brain: Default. Switch brain`. Choose another ready brain if one exists. The tree refresh key bumps and tabs clear. Switch back to Default before finishing.
- **Delete / retry (code-guaranteed; do not click).** Non-default rows keep an icon button while `error` or `deleting`: `aria-label="Delete brain"` or `aria-label="Retry delete"`. That opens dialog `Delete brain "{display_name}"?`. Confirm by typing the display name; footer button `Delete brain` (becomes `Deleting…`). Default cannot be deleted.
- **Error gate (code-guaranteed; skip unless you land on an errored brain).** Knowledge shows heading `Brain failed to provision` and button `Delete & retry` (links to `/brains`). A `deleting` brain shows heading `Brain is being deleted` with no delete button on that gate.
- **Proof.** Screenshot `artifacts/brains/list.png` with Default visible. Do not capture bearer tokens.

## Gotchas

- Creating a brain invokes BrainProvisionerFn (real AWS). Skip unless the user asked.
- Deleting a brain empties its S3 bucket. Never use delete or retry-delete in a default verify run. The retry control exists so a teardown that failed after status flipped to `deleting` is not stranded.
- Switching brains closes all Knowledge tabs.
