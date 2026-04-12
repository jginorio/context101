# Team Brain 🧠

A shared team knowledge base exposed via MCP. Everyone's AI tools connect to the same brain.

The analytics person stores insights → the manager sees them and stores decisions → the engineer gets full context when building. All through whatever MCP client they already use.

## How It Works

- **`store_knowledge`** — Add knowledge with title, content, tags, author
- **`search_knowledge`** — Semantic search powered by Voyage AI embeddings. Returns compact results (title, snippet, relevance, ID). Natural language queries like "why are users leaving the pricing page" will find entries about "bounce rate increase" even though the words are different
- **`read_knowledge`** — Fetch the full content of a specific entry by ID (use after search)
- **`list_tags`** — Browse what knowledge exists
- **`delete_knowledge`** — Remove an entry by ID

## Deploy to Horizon (recommended)

1. Push this repo to GitHub
2. Go to [horizon.prefect.io](https://horizon.prefect.io)
3. Connect the repo — Horizon auto-detects `server.py:mcp`
4. Set the `VOYAGE_API_KEY` env var in Horizon settings
5. Get your production URL with OAuth built in

That's it. Share the URL with the team.

## Local Development

```bash
# Install
pip install -r requirements.txt

# Set your Voyage API key
export VOYAGE_API_KEY="your-key-here"

# (Optional) Seed with example data
python seed.py

# Run with HTTP transport
fastmcp run server.py:mcp --transport streamable-http --port 8787

# Or run with stdio for local testing
fastmcp run server.py:mcp
```

## Connect MCP Clients

Replace `YOUR_HORIZON_URL` with your Horizon deployment URL (or `http://localhost:8787/mcp` for local).

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "team-brain": {
      "type": "streamable-http",
      "url": "YOUR_HORIZON_URL"
    }
  }
}
```

### Cursor

`.cursor/mcp.json`

```json
{
  "mcpServers": {
    "team-brain": {
      "type": "streamable-http",
      "url": "YOUR_HORIZON_URL"
    }
  }
}
```

### Claude Code

```bash
claude mcp add team-brain --transport http YOUR_HORIZON_URL
```

## Example Flow

**Maria (analytics)** in Claude Desktop:
> "Store this in team brain: Q1 conversion dropped 12%, bounce rate on pricing is 73%, users don't scroll past the fold. Tag it analytics, conversion."

**Carlos (manager)** in Claude Desktop:
> "Search team brain for conversion problems"
> → Gets Maria's analysis with full context
>
> "Store a decision: we're prioritizing click event tracking based on conversion data"

**Jake (engineer)** in Cursor:
> "Search team brain for click tracking — what needs to be built and why?"
> → Gets Maria's analytics AND Carlos's decision → has full context to start coding

## Architecture

```
┌─────────────────┐  ┌─────────────┐  ┌───────────────┐
│ Claude Desktop   │  │   Cursor    │  │  Claude Code  │
│ (anyone)         │  │ (engineers) │  │  (engineers)  │
└────────┬─────────┘  └──────┬──────┘  └───────┬───────┘
         │                   │                  │
         └───────────┬───────┴──────────────────┘
                     │ MCP (streamable HTTP)
                     ▼
           ┌──────────────────┐
           │  Prefect Horizon │ ← OAuth, scaling, CI/CD
           │  ┌────────────┐  │
           │  │ Team Brain │  │
           │  │ MCP Server │  │
           │  └─────┬──────┘  │
           └────────│─────────┘
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
  ┌──────────────┐   ┌──────────────┐
  │  Voyage AI   │   │   SQLite     │
  │  Embeddings  │   │  (metadata)  │
  └──────────────┘   └──────────────┘
```

## Env Vars

| Variable | Required | Description |
|----------|----------|-------------|
| `VOYAGE_API_KEY` | Yes | Voyage AI API key for embeddings |
| `TEAM_BRAIN_DATA_DIR` | No | Where SQLite DB lives (default: `./data`) |
| `TEAM_BRAIN_EMBED_MODEL` | No | Voyage model (default: `voyage-3.5`) |

## What's Next

This is a PoC. Once the team validates it, consider:

- **Web UI** for non-technical teammates to browse/add without MCP
- **Auth/permissions** — who can write vs read
- **Ingestion pipelines** — auto-import from Notion, Slack, Google Docs
- **Namespaces** — separate knowledge by team or project
- **AgentCore Memory** — migrate to AWS managed infra at scale
