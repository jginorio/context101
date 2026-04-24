# Sentry MCP — Configuration & Usage

## Organization Details

| Detail              | Value                                        |
| ------------------- | -------------------------------------------- |
| Org slug            | `bluepath-group-llc`                         |
| Region URL          | `https://us.sentry.io`                       |
| API project         | `finditpr-nestjs` (NestJS backend errors)    |
| Frontend project    | `finditpr-com` (Next.js SSR + client errors) |

## MCP Server

The Sentry MCP server is `user-sentry`. It provides structured access to issues, events, breadcrumbs, and replays without needing to parse the Sentry web UI.

## Key Tools

### `search_issues` — Find issues by description

```
search_issues(
  organizationSlug='bluepath-group-llc',
  naturalLanguageQuery='unresolved 500 errors on blog',
  projectSlugOrId='finditpr-com',
  regionUrl='https://us.sentry.io'
)
```

**Gotcha:** Does NOT support `OR`/`AND` boolean operators in the query — use separate calls instead.

### `get_sentry_resource` — Get full issue details

From a URL:
```
get_sentry_resource(url='https://bluepath-group-llc.sentry.io/issues/FINDITPR-COM-139/')
```

Returns: error message, stacktrace, tags, HTTP request details, related replays.

### `get_sentry_resource` with `resourceType='breadcrumbs'`

```
get_sentry_resource(
  url='https://bluepath-group-llc.sentry.io/issues/FINDITPR-COM-139/',
  resourceType='breadcrumbs'
)
```

Returns the trail of API calls, console logs, and HTTP requests leading to the crash. The `digest` field in breadcrumbs is especially useful for Next.js errors:
- `DYNAMIC_SERVER_USAGE` — dynamic API called during static render
- `NEXT_NOT_FOUND` — notFound() was called
- `NEXT_REDIRECT` — redirect() was called

### `search_events` — Aggregate counts and stats

```
search_events(
  organizationSlug='bluepath-group-llc',
  projectSlugOrId='finditpr-com',
  naturalLanguageQuery='count of 500 errors today'
)
```

Use this for counts/aggregations instead of `search_issues`.

## Investigation Workflow

1. **Search** — `search_issues` scoped to the right project (`finditpr-com` for frontend, `finditpr-nestjs` for API)
2. **Inspect** — `get_sentry_resource` with the issue URL for full error details
3. **Breadcrumbs** — `get_sentry_resource` with `resourceType='breadcrumbs'` to see the events leading to the crash
4. **Fix** — Reference the issue ID in commit messages (`Fixes FINDITPR-COM-XXX`) to auto-close on merge

## Tips

- Production Next.js builds hide the real error behind a generic message. Always check breadcrumbs for the `digest` value to understand what actually happened.
- Filter by `environment` tag (`staging` vs `production`) when searching.
- The frontend project captures both client-side and SSR errors — check the `transaction` tag to see which route triggered it (e.g., `GET /[locale]/blog/[slug]/page`).
- If `search_issues` returns nothing, try broadening the query or checking the other project (`finditpr-nestjs` vs `finditpr-com`).