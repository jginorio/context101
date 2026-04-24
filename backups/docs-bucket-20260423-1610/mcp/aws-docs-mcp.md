# AWS Docs MCP Server

Install the AWS Docs MCP server to give AI agents better context on how AWS products work.

## Configuration

```json
"awslabs.aws-documentation-mcp-server": {
  "command": "uvx",
  "args": ["awslabs.aws-documentation-mcp-server@latest"],
  "env": {
    "FASTMCP_LOG_LEVEL": "ERROR",
    "AWS_DOCUMENTATION_PARTITION": "aws"
  },
  "disabled": false,
  "autoApprove": []
}
```
