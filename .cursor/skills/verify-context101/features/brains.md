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

- **List.** Navigate to `/brains`. Button `New brain` is visible. Default appears as a card/row with status ready.
- **Switch.** On `/knowledge`, click `Active brain: Default. Switch brain`. Choose another ready brain if one exists (e.g. Platea Analytics). The tree refresh key bumps and tabs clear. Switch back to Default before finishing.
- **Proof.** Screenshot `artifacts/brains/list.png` with Default visible. Do not capture bearer tokens.

## Gotchas

- Creating a brain invokes BrainProvisionerFn (real AWS). Skip unless the user asked.
- Deleting a brain empties its S3 bucket. Default cannot be deleted. Never use delete in a default verify run.
- Switching brains closes all Knowledge tabs.
