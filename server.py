"""
Context101 — Shared team knowledge base via MCP, backed by Amazon Bedrock Knowledge Bases.

Tools:
  - search_knowledge:   Semantic search against the KB (wraps bedrock-agent-runtime:Retrieve)
  - read_knowledge:     Fetch the full content of a source document by S3 key
  - list_sources:       List available documents in the S3 docs bucket
  - suggest_knowledge:  Propose a new doc or an improvement — queued for human review

Stack:
  - FastMCP (Python) for MCP protocol
  - boto3 for Bedrock Agent Runtime + S3 + DynamoDB
  - Knowledge Base (Titan embed v2 + S3 Vectors) provisioned via CDK
  - Suggestions queue in DynamoDB (context101-suggestions)

Auth:
  - If CONTEXT101_TOKEN env var is set, the server requires
    `Authorization: Bearer <token>` on every request.
  - If unset (e.g. local dev), the server runs without auth.
"""

import os
import uuid
from datetime import datetime, timezone
from typing import Any

import boto3
from botocore.config import Config
from fastmcp import FastMCP

# ── Config ────────────────────────────────────────────────────────────

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
KB_ID = os.environ.get("KB_ID")
DOCS_BUCKET = os.environ.get("DOCS_BUCKET")  # Needed for read_knowledge / list_sources
SUGGESTIONS_TABLE = os.environ.get("SUGGESTIONS_TABLE")  # Needed for suggest_knowledge
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
ddb = _session.resource("dynamodb", config=_boto_cfg)


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

Retrieval is two-tier:

  • search_knowledge returns chunks from the *canonical wiki* — synthesized,
    deduplicated pages generated from the team's raw sources. This is the
    default path. Wiki chunks cite their provenance via inline `Sources: [file]()`
    footnotes and via the `source_files` metadata on each page.

  • read_knowledge can fetch any document by its S3 key — including the raw
    source docs the wiki was synthesized from. Use it when a canonical chunk
    cites a raw file and you need the ground-truth content (e.g. to verify the
    synthesized claim or pull a detail that didn't make it into the wiki).

Workflow:
  1. Call search_knowledge with a natural-language question. You get ranked
     canonical chunks with their wiki page's S3 key and a relevance score.
  2. If the canonical chunk references a source file and you need the full
     detail, call read_knowledge(s3_key) on the cited source.
  3. Use list_sources if you just want to enumerate what's in the bucket.
  4. If you discover something worth preserving (a missing fact, an
     inaccuracy, a better explanation), call suggest_knowledge. The
     suggestion goes to a human-review queue — never written to the brain
     automatically. Approved suggestions flow to the raw docs and surface
     in the canonical wiki on the next regeneration.

Available tools:
- search_knowledge(query, limit=5): semantic search over canonical wiki chunks
- read_knowledge(s3_key): full content of any document (raw or wiki)
- list_sources(): list all documents in the S3 bucket
- suggest_knowledge(title, content, target_path?, rationale?, trigger?):
    propose a new doc or update an existing one; goes to the review queue
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
    """Semantic search against the canonical wiki.

    Retrieval is scoped to wiki chunks — synthesized pages the generator
    produces from the raw corpus, tagged `source=wiki` via .metadata.json
    sidecars. Raw source docs are excluded here; reach them via
    read_knowledge when a wiki chunk cites a specific file.

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
            "vectorSearchConfiguration": {
                "numberOfResults": limit,
                "filter": {"equals": {"key": "source", "value": "wiki"}},
            }
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
    """Read the full content of any document in the docs bucket by S3 key.

    This is the escape hatch to ground-truth content. search_knowledge only
    returns canonical wiki chunks, which are synthesized and may compress or
    omit detail. When a wiki chunk cites a raw source (either inline via
    `Sources: [file]()` or in the page's `source_files` metadata), use this
    to pull the full unedited source.

    Works on both raw docs (e.g. "domain-knowledge/amplia.md") and wiki pages
    (e.g. "wiki/overview.md") — whatever key you pass.

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


@mcp.tool()
def suggest_knowledge(
    title: str,
    content: str,
    target_path: str | None = None,
    rationale: str | None = None,
    trigger: str | None = None,
) -> str:
    """Suggest new knowledge or an improvement to an existing doc.

    The suggestion lands in the review queue — it is NOT written to the brain
    automatically. A human reviews it in the Context101 admin UI and either
    approves (it becomes part of the brain) or rejects it.

    Use this when you discover:
      - A new fact, pattern, or convention worth preserving
      - An inaccuracy in an existing doc
      - A missing cross-reference
      - A better explanation of something already covered

    Args:
        title: Short headline describing the suggestion (max 80 chars).
        content: Full proposed markdown. For updates, this is the complete
                 replacement content (not a patch). For new docs, this is the
                 full document body.
        target_path: S3 key of an existing doc to update. Omit for a new doc
                     — the reviewer picks the destination path when approving.
        rationale: Why this suggestion is useful. What prompted it.
        trigger: When the reader is likely to need this
                 (e.g. "when querying amplia", "when deploying to ECS").

    Returns:
        The suggestion's ID (for audit/traceability).
    """
    if not SUGGESTIONS_TABLE:
        return (
            "Suggestions are disabled: SUGGESTIONS_TABLE env var is not set. "
            "Deploy the CDK stack with the Suggestions table, or ask an admin."
        )
    if not title.strip() or not content.strip():
        return "Both `title` and `content` are required."
    if len(title) > 200:
        return "Title too long (max 200 chars)."
    if len(content) > 200_000:
        return "Content too large (>200KB). Split into a smaller suggestion."

    table = ddb.Table(SUGGESTIONS_TABLE)
    suggestion_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    item: dict[str, Any] = {
        "id": suggestion_id,
        "status": "pending",
        "created_at": now,
        "title": title.strip()[:200],
        "content": content,
    }
    if target_path:
        item["target_path"] = target_path.strip()
    if rationale:
        item["rationale"] = rationale.strip()[:2000]
    if trigger:
        item["trigger"] = trigger.strip()[:500]

    table.put_item(Item=item)

    kind = f"update to `{target_path}`" if target_path else "new document"
    return (
        f"✅ Suggestion submitted ({kind}).\n\n"
        f"**ID:** `{suggestion_id}`\n"
        f"**Title:** {title}\n"
        f"**Status:** pending — a human will review it in the Context101 admin UI. "
        f"The change will not be part of the brain until approved."
    )
