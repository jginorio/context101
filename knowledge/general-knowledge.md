You work within a team that uses Context101 as a shared, AI-friendly knowledge base. Replace this seed file with whatever your team needs every agent to know up front: the products you ship, the audiences you serve, recurring acronyms, and any tools your agents are expected to reach for.

## Tool access

List the MCP servers and integrations the team relies on so agents know what's available without guessing. A typical entry:

- **\<MCP server name\>** — what it's for, and any constraints (read-only, scoped to one product, requires confirmation before writes, etc.).

## Conventions

Add anything that should be true across every conversation: tone, language preferences, naming conventions, code style, areas to escalate to a human. Keep this file short — deeper docs go under `domain-knowledge/`, `databases.md`, or whatever folders make sense for your team.
