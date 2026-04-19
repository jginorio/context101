"""
Context101 — Shared team knowledge base via MCP, backed by Amazon Bedrock Knowledge Bases.

Tools:
  - search_knowledge: Semantic search against the KB (wraps bedrock-agent-runtime:Retrieve)
  - read_knowledge:   Fetch the full content of a source document by S3 key
  - list_sources:     List available documents in the S3 docs bucket

Stack:
  - FastMCP (Python) for MCP protocol
  - boto3 for Bedrock Agent Runtime + S3
  - Knowledge Base (Titan embed v2 + S3 Vectors) provisioned via CDK

Auth:
  - If CONTEXT101_TOKEN env var is set, the server requires
    `Authorization: Bearer <token>` on every request.
  - If unset (e.g. local dev), the server runs without auth.
"""

import os
from typing import Any

import boto3
from botocore.config import Config
from fastmcp import FastMCP

# ── Config ────────────────────────────────────────────────────────────

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
KB_ID = os.environ.get("KB_ID")
DOCS_BUCKET = os.environ.get("DOCS_BUCKET")  # Needed for read_knowledge / list_sources
AWS_PROFILE = os.environ.get("AWS_PROFILE")
TOKEN = os.environ.get("CONTEXT101_TOKEN")  # Optional bearer token

if not KB_ID:
    raise RuntimeError(
        "KB_ID env var is required. Set it to the Bedrock Knowledge Base ID "
        "output by `cdk deploy`."
    )

# ── AWS clients ───────────────────────────────────────────────────────

_session = boto3.Session(region_name=AWS_REGION, profile_name=AWS_PROFILE)
_boto_cfg = Config(retries={"max_attempts": 3, "mode": "standard"})

bedrock_runtime = _session.client("bedrock-agent-runtime", config=_boto_cfg)
s3 = _session.client("s3", config=_boto_cfg)


# ── Auth ──────────────────────────────────────────────────────────────

def _build_auth():
    """Return a StaticTokenVerifier if CONTEXT101_TOKEN is set, else None."""
    if not TOKEN:
        return None
    from fastmcp.server.auth.providers.jwt import StaticTokenVerifier

    return StaticTokenVerifier(
        tokens={TOKEN: {"client_id": "context101-team", "scopes": ["read"]}},
    )


# ── MCP Server ────────────────────────────────────────────────────────

mcp = FastMCP(
    "Context101",
    instructions="""You are the librarian for Context101, a shared team knowledge base.

The knowledge base is built on Amazon Bedrock — queries use semantic similarity
over the team's markdown documents, so natural-language questions like
"how do I query listings in Amplia" will find relevant chunks even if those
exact words aren't in the docs.

Workflow:
  1. Use search_knowledge for a semantic query. It returns ranked text chunks
     with their source S3 key and a relevance score.
  2. If a chunk looks promising but you need more context, call read_knowledge
     with the source S3 key to read the full document.
  3. Use list_sources if you just want to see what documents exist.

Available tools:
- search_knowledge(query, limit=5): semantic search, returns ranked chunks
- read_knowledge(s3_key): full content of a source document
- list_sources(): list all documents in the knowledge base
""",
    auth=_build_auth(),
)


# ── Helpers ───────────────────────────────────────────────────────────


def _source_key_from_retrieval(result: dict[str, Any]) -> str:
    """Extract the S3 object key from a Retrieve result."""
    loc = result.get("location", {})
    s3_loc = loc.get("s3Location") or {}
    uri = s3_loc.get("uri", "")
    if uri.startswith("s3://"):
        without_scheme = uri[5:]
        return without_scheme.split("/", 1)[1] if "/" in without_scheme else without_scheme
    return uri


# ── Tools ─────────────────────────────────────────────────────────────


@mcp.tool()
def search_knowledge(query: str, limit: int = 5) -> str:
    """Semantic search against the team knowledge base.

    Wraps the Bedrock `Retrieve` API. Returns ranked text chunks from the
    most relevant documents, each with its source S3 key and a relevance score.

    Args:
        query: Natural-language question, e.g. "how do I find active listings in Amplia"
        limit: Max number of chunks to return (default 5, max 20)

    Returns:
        Markdown-formatted list of chunks with source + score + text.
    """
    limit = max(1, min(limit, 20))

    resp = bedrock_runtime.retrieve(
        knowledgeBaseId=KB_ID,
        retrievalQuery={"text": query},
        retrievalConfiguration={
            "vectorSearchConfiguration": {"numberOfResults": limit}
        },
    )

    results = resp.get("retrievalResults", [])
    if not results:
        return f'No results for "{query}".'

    blocks = [f'Found {len(results)} result(s) for "{query}".\n']
    for i, r in enumerate(results, 1):
        content = (r.get("content") or {}).get("text", "").strip()
        score = r.get("score", 0.0)
        key = _source_key_from_retrieval(r)
        blocks.append(
            f"### {i}. `{key}`  ·  score {score:.3f}\n\n{content}\n"
        )
    return "\n---\n\n".join(blocks)


@mcp.tool()
def read_knowledge(s3_key: str) -> str:
    """Read the full content of a source document by its S3 key.

    Use after search_knowledge when a chunk looks promising but you want the
    full context of the source document.

    Args:
        s3_key: Object key inside the docs bucket, e.g. "domain-knowledge/amplia.md"
    """
    if not DOCS_BUCKET:
        return (
            "DOCS_BUCKET env var is not set. This tool needs to know which "
            "S3 bucket to read from. Set it to the bucket name output by `cdk deploy`."
        )
    try:
        obj = s3.get_object(Bucket=DOCS_BUCKET, Key=s3_key)
        body = obj["Body"].read().decode("utf-8", errors="replace")
        return f"# {s3_key}\n\n{body}"
    except s3.exceptions.NoSuchKey:
        return f"Not found in docs bucket: {s3_key}"
    except Exception as e:  # noqa: BLE001
        return f"Error reading {s3_key}: {e}"


@mcp.tool()
def list_sources() -> str:
    """List all documents available in the knowledge base."""
    if not DOCS_BUCKET:
        return (
            "DOCS_BUCKET env var is not set. This tool needs to know which "
            "S3 bucket to list. Set it to the bucket name output by `cdk deploy`."
        )

    keys: list[str] = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=DOCS_BUCKET):
        for obj in page.get("Contents", []):
            if obj["Key"].endswith(".metadata.json") or obj["Key"].endswith("/"):
                continue
            keys.append(obj["Key"])

    if not keys:
        return "The docs bucket is empty. Upload markdown files to populate the knowledge base."

    lines = [f"**{len(keys)} document(s) in the knowledge base:**", ""]
    lines.extend(f"- `{k}`" for k in sorted(keys))
    return "\n".join(lines)
