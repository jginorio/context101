# Metabase MCP Installation

This document provides the configuration snippet for installing the Metabase MCP server, for cases where the user requesting knowledge does not already have it configured.

## MCP Configuration

Add the following entry to your MCP client configuration:

```json
    "metabase": {
      "type": "stdio",
      "command": "uvx",
      "args": ["metabase-mcp"],
      "env": {
        "METABASE_URL": "https://metabase.finditpr.com",
        "METABASE_API_KEY": "<your-api-key>"
      }
    }
```
