# Wiki is parked

Context101 shipping product is sources + retrieve (admin retrieve,
MCP `search_knowledge`). Wiki generation is paused / beta and is **not**
on the mainline product surface.

## What stays in the stack

- `wiki-generator-ts/` and the CDK wiki Fargate image (`WikiGenImage`)
- Wiki generator cluster / task definition / start-wiki-gen Lambda
- `POST /api/wiki/retrieve` — this is the shipping retrieve path, not wiki chrome
- Raw-first search still excludes `wiki/` and `source=wiki` / `code-wiki`

## What is off on main

- Admin Wiki nav, Ask the brain, Go to wiki, `/wiki*` chrome (redirects to `/knowledge`)
- Settings → Advanced wiki model / Wiki regeneration
- EventBridge `WikiGenSchedule` remains **disabled**
- `AUTO_TRIGGER_CODE_WIKI` is **false** — GitHub sync must not auto-fire code wiki

Do not re-enable the schedule or `AUTO_TRIGGER_CODE_WIKI` as part of a
UI restore. Isolated testing lives on `cursor/wiki-isolated-de63`.
