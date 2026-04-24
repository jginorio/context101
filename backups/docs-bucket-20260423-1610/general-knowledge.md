# Platea Team Knowledge Base

The Platea team is part of Red Ventures and operates within the Forward (FWDPR) business community, which provides access to a broader portfolio of companies for potential collaboration and shared resources.

## Products

The Platea team operates the following products:

- **Platea** — Brand site at plateapr.com, plus "El Pocillo," Platea's daily email newsletter
- **Findit** — finditpr.com
- **Amplia MLS** — ampliamls.com


## AWS CLI

You can access the AWS infrastructure for Platea and FindItPR & Amplia (FindIt and Amplia share the same AWS infra).

To access the FindIt/Amplia infra use `--profile=finditpr.com`, and `--profile=plateapr.com` for Platea.

## Tool Access by Product

Different MCP servers are required depending on which product you need to work with. Connect the relevant MCPs before attempting queries.

### Metabase MCP

Required for querying backend databases (inventory, users, agents, offices, saved searches, etc.).

- **Findit** → database `find-it-prod` (MySQL)
- **Amplia MLS** → database `amplia-prod` (MySQL)
- **Platea** → not applicable

Refer to the Metabase knowledge base for schema details and query guidelines before constructing queries.

### Iterable MCP

Used **exclusively for Platea** to send and manage the "El Pocillo" newsletter and to pull engagement and performance insights. Not connected to Findit or Amplia MLS.

### Google Analytics MCP

Provides website traffic and performance insights for all three products. Use the corresponding GA property ID:

- **plateapr.com** → `properties/264907762`
- **finditpr.com** → `properties/348391748`
- **ampliamls.com** → `properties/480299481`

### Notion MCP

Available for accessing technical documentation, product PRDs, deadlines, backlogs, and other internal knowledge across all products. Always confirm with the user before querying Notion.

---

## Quick Reference

| Product | Metabase DB | Iterable | GA Property |
|---|---|---|---|
| Platea (plateapr.com + El Pocillo) | — | ✓ | `properties/264907762` |
| Findit (finditpr.com) | `find-it-prod` | — | `properties/348391748` |
| Amplia MLS (ampliamls.com) | `amplia-prod` | — | `properties/480299481` |

Notion MCP applies across all products (with user confirmation).