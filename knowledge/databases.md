# Database context (example)

Replace this seed file with the actual schemas your agents need to query. The shape below is a starting template — keep what's useful, drop what isn't.

## \<Database name\> (`\<connection-id\>`)

A one-paragraph description of what this database is for and which product owns it.

### Core tables

| Table        | Purpose                            | Notable columns                                  |
| ------------ | ---------------------------------- | ------------------------------------------------ |
| `users`      | Registered accounts                | `id`, `email`, `created_at`, `status`            |
| `widgets`    | The primary product objects        | `id`, `owner_id` → `users.id`, `state`, `price`  |
| `events`     | Append-only activity log           | `id`, `widget_id`, `actor_id`, `kind`, `at`      |

### Conventions

- Timestamps are UTC unless noted otherwise.
- Soft-deletes use `deleted_at IS NOT NULL` — exclude these in normal queries.
- Foreign keys not declared at the DB level (legacy reasons); consult this doc before joining.

### Useful query patterns

```sql
-- Active widgets in the last 30 days
SELECT w.*
FROM widgets w
WHERE w.state = 'active'
  AND w.created_at >= NOW() - INTERVAL '30 days';
```

Document the gotchas an agent would otherwise have to discover the hard way: enum values that look opaque, columns that mean different things in different states, joins that need to be qualified by tenant ID, and so on.
