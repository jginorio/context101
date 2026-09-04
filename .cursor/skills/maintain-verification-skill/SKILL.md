---
name: maintain-verification-skill
description: Update the Context101 verify-context101 skill after merged admin PRs so a cold agent can still drive the real Knowledge UI. Use when the user asks to /maintain-verification-skill, or after landing Knowledge / wiki / brains / sources / login changes.
---

# Maintain verification skill

`.cursor/skills/verify-context101/` is the cold-start map for the Next.js admin. After user-facing admin PRs merge (or when building a new one), refresh that map so recipes, ARIA handles, and HTTP helpers still match the running app.

MCP and marketing `site/` stay out of scope.

## Do

1. List recently merged PRs that touch `web/` admin surfaces (Knowledge library, viewer, wiki, brains, sources, login). Infra-only PRs (Amplify, Docker, CDK, lockfiles) are a skip note, not a new feature file.
2. Diff those changes against `features/README.md` and each `features/*.md`. Walk the current components if a PR added a dialog, tree action, or side effect that the map never named.
3. Add or edit recipes for new controls. Prefer ARIA names (`New file`, `Add a source`, treeitem filenames) over CSS. Keep isolation: `verify/<run-id>/`, doctor, `bin/auth-cookie`, Default brain.
4. If a mutation writes S3, keep the `bin/files` proof. If it can change the vector index (create / rename / move / delete), point at [library-ingest](../verify-context101/features/library-ingest.md).
5. Update the handles table in `verify-context101/SKILL.md` when a stable name appears or changes.
6. Do not invent unverified behavior. If you have not driven the control, write only what the code guarantees and mark optional / skip paths.

## Do not

- Provision or delete brains, click **Refresh now**, or submit **Add a source** (that creates a real connector) in a default recipe.
- Write credentials, tenant file names, or host-specific AWS secret names into the skill.
- Treat a list/get pass as ingest proof.
- Delete `artifacts/` (gitignored proof from prior runs).

## Output

- Updated `features/*.md` and `SKILL.md` when the UI actually changed.
- A short changelog: which PRs were mapped, which were infra-only skips.
