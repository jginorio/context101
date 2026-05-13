"""
Context101 — Shared team knowledge base via MCP, backed by Amazon Bedrock Knowledge Bases.

Tools:
  - search_knowledge:   Semantic search against the active brain's KB
  - read_knowledge:     Fetch the full content of a source document by S3 key
  - list_sources:       List available documents in the active brain's S3 bucket
  - suggest_knowledge:  Propose a new doc or improvement — queued for human review

Multi-brain routing:
  The same MCP service serves every brain. Clients reach a specific brain via:

    https://<mcp-host>/brain/<brain_id>/mcp     (preferred — explicit)
    https://<mcp-host>/mcp                       (legacy alias — default brain)

  Brain identity, the KB/bucket/table handles, and the bearer-token secret
  ARN come from the BRAINS_TABLE DDB registry (populated by the web admin
  UI's "Create brain" flow + the RegisterDefaultBrain CDK custom resource).
  Token values are read on-demand from Secrets Manager and cached.

Auth:
  Each brain has its own bearer token in Secrets Manager. The middleware
  resolves the brain from the URL path, fetches that brain's token, and
  validates `Authorization: Bearer <token>`. Path mismatch → 404; token
  mismatch → 401. Tools never see the token.
"""

import os
import time
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any

import boto3
from botocore.config import Config
from fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount

# ── Config ────────────────────────────────────────────────────────────

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
BRAINS_TABLE = os.environ.get("BRAINS_TABLE")
AWS_PROFILE = os.environ.get("AWS_PROFILE")

if not BRAINS_TABLE:
    raise RuntimeError(
        "BRAINS_TABLE env var is required. Set it to the DDB table name "
        "output by `cdk deploy`."
    )

# ── AWS clients ───────────────────────────────────────────────────────

_session = boto3.Session(region_name=AWS_REGION, profile_name=AWS_PROFILE)
_boto_cfg = Config(retries={"max_attempts": 3, "mode": "standard"})

bedrock_runtime = _session.client("bedrock-agent-runtime", config=_boto_cfg)
s3_client = _session.client("s3", config=_boto_cfg)
ddb = _session.resource("dynamodb", config=_boto_cfg)
secrets_client = _session.client("secretsmanager", config=_boto_cfg)

_brains_table = ddb.Table(BRAINS_TABLE)


# ── Brain context — propagated through asyncio via ContextVar ─────────

_current_brain: ContextVar[dict[str, Any] | None] = ContextVar(
    "current_brain", default=None
)


def _brain() -> dict[str, Any]:
    """Return the brain config the current request is scoped to.

    Raises if no brain is in context — tools should never be called outside
    a request, so this should never happen in practice.
    """
    b = _current_brain.get()
    if b is None:
        raise RuntimeError("no brain in context (called outside a request?)")
    return b


# ── Caches (process-local; TTL'd so updates propagate without redeploy) ─

_BRAIN_TTL = 60.0   # seconds — re-read the registry row this often
_TOKEN_TTL = 300.0  # seconds — re-read the token secret this often

_brain_cache: dict[str, tuple[dict[str, Any], float]] = {}
_token_cache: dict[str, tuple[str, float]] = {}


def _load_brain(brain_id: str) -> dict[str, Any] | None:
    """Fetch a brain row from BRAINS_TABLE; None if missing or not ready."""
    cached = _brain_cache.get(brain_id)
    if cached and time.monotonic() - cached[1] < _BRAIN_TTL:
        return cached[0]
    try:
        resp = _brains_table.get_item(Key={"brain_id": brain_id})
    except Exception as e:  # noqa: BLE001
        print(f"[mcp] failed to load brain {brain_id}: {e}")
        return None
    item = resp.get("Item")
    if not item or item.get("status") != "ready":
        return None
    _brain_cache[brain_id] = (item, time.monotonic())
    return item


def _load_token(secret_arn: str) -> str | None:
    """Fetch a brain's bearer token from Secrets Manager."""
    cached = _token_cache.get(secret_arn)
    if cached and time.monotonic() - cached[1] < _TOKEN_TTL:
        return cached[0]
    try:
        resp = secrets_client.get_secret_value(SecretId=secret_arn)
    except Exception as e:  # noqa: BLE001
        print(f"[mcp] failed to read token secret {secret_arn}: {e}")
        return None
    value = resp.get("SecretString")
    if not value:
        return None
    _token_cache[secret_arn] = (value, time.monotonic())
    return value


# ── MCP Server (single FastMCP, brain comes from contextvar) ──────────

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
    # Auth is handled in the brain-routing middleware below — FastMCP-level
    # auth would only see one token, and we need per-brain validation.
    auth=None,
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
    """Semantic search against the active brain's canonical wiki.

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
    brain = _brain()
    limit = max(1, min(limit, 20))

    resp = bedrock_runtime.retrieve(
        knowledgeBaseId=brain["kb_id"],
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
        return f'No results for "{query}" in brain `{brain["brain_id"]}`.'

    blocks = [
        f'Found {len(results)} result(s) for "{query}" in brain `{brain["brain_id"]}`.\n'
    ]
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
    """Read the full content of any document in the active brain's bucket.

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
    brain = _brain()
    bucket = brain["docs_bucket"]
    try:
        obj = s3_client.get_object(Bucket=bucket, Key=s3_key)
        body = obj["Body"].read().decode("utf-8", errors="replace")
        return f"# {s3_key}\n\n{body}"
    except s3_client.exceptions.NoSuchKey:
        return f"Not found in brain `{brain['brain_id']}` docs bucket: {s3_key}"
    except Exception as e:  # noqa: BLE001
        return f"Error reading {s3_key}: {e}"


@mcp.tool()
def list_sources() -> str:
    """List all documents available in the active brain's knowledge base."""
    brain = _brain()
    bucket = brain["docs_bucket"]

    keys: list[str] = []
    paginator = s3_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket):
        for obj in page.get("Contents", []):
            if obj["Key"].endswith(".metadata.json") or obj["Key"].endswith("/"):
                continue
            keys.append(obj["Key"])

    if not keys:
        return (
            f"Brain `{brain['brain_id']}` docs bucket is empty. "
            "Upload markdown files to populate the knowledge base."
        )

    lines = [
        f"**{len(keys)} document(s) in brain `{brain['brain_id']}`:**",
        "",
    ]
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
    """Suggest new knowledge or an improvement to an existing doc in the
    active brain.

    The suggestion lands in the brain's review queue — it is NOT written to
    the brain automatically. A human reviews it in the Context101 admin UI
    and either approves (it becomes part of the brain) or rejects it.

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
    brain = _brain()
    suggestions_table_name = brain.get("suggestions_table")
    if not suggestions_table_name:
        return (
            f"Suggestions are disabled for brain `{brain['brain_id']}` "
            "(no suggestions table on the registry row)."
        )
    if not title.strip() or not content.strip():
        return "Both `title` and `content` are required."
    if len(title) > 200:
        return "Title too long (max 200 chars)."
    if len(content) > 200_000:
        return "Content too large (>200KB). Split into a smaller suggestion."

    table = ddb.Table(suggestions_table_name)
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
        f"✅ Suggestion submitted to brain `{brain['brain_id']}` ({kind}).\n\n"
        f"**ID:** `{suggestion_id}`\n"
        f"**Title:** {title}\n"
        f"**Status:** pending — a human will review it in the Context101 admin UI. "
        f"The change will not be part of the brain until approved."
    )


# ── ASGI plumbing: brain-routing + token validation ───────────────────


def _extract_bearer(scope: dict) -> str | None:
    """Pull the Authorization: Bearer <token> value from an ASGI scope."""
    for name, value in scope.get("headers", []) or []:
        if name == b"authorization":
            decoded = value.decode("latin-1", errors="replace")
            if decoded.lower().startswith("bearer "):
                return decoded[7:].strip()
    return None


def _json_response(status: int, body: dict[str, Any]):
    """Build a minimal ASGI JSON response."""
    return JSONResponse(body, status_code=status)


# FastMCP exposes its HTTP transport as a Starlette ASGI app. Depending on
# the FastMCP version the accessor is `streamable_http_app()` (preferred)
# or `http_app()`. We support both so this server runs on either.
def _build_mcp_asgi():
    for attr in ("streamable_http_app", "http_app"):
        fn = getattr(mcp, attr, None)
        if callable(fn):
            return fn()
    raise RuntimeError(
        "FastMCP instance has no HTTP ASGI app accessor "
        "(expected `streamable_http_app` or `http_app`)."
    )


_mcp_app = _build_mcp_asgi()


async def _dispatch(scope, receive, send):
    """ASGI entrypoint — resolves the brain from the URL path, validates the
    bearer token against that brain's secret, and delegates to FastMCP.

    Path shapes:
      /brain/<brain_id>/mcp[/...]     → that brain
      /mcp[/...]                       → "default" brain (legacy)
      anything else                    → 404
    """
    if scope["type"] != "http":
        # Defensive: streamable_http_app supports streaming responses but
        # we only proxy http. Pass through unknown types unchanged.
        return await _mcp_app(scope, receive, send)

    path: str = scope["path"]
    if path.startswith("/brain/"):
        # /brain/<id>/mcp[/...]
        parts = path.split("/", 4)
        # parts = ["", "brain", "<id>", "mcp", "<rest>"]
        if len(parts) < 4 or parts[3] != "mcp":
            return await _json_response(
                404, {"error": "not found"}
            )(scope, receive, send)
        brain_id = parts[2]
        rest = "/" + parts[4] if len(parts) >= 5 else ""
        new_path = "/mcp" + rest
    elif path == "/mcp" or path.startswith("/mcp/"):
        brain_id = "default"
        new_path = path
    elif path == "/healthz" or path == "/":
        return await _json_response(
            200, {"status": "ok", "service": "context101-mcp"}
        )(scope, receive, send)
    else:
        return await _json_response(
            404, {"error": f"unknown path {path}"}
        )(scope, receive, send)

    brain = _load_brain(brain_id)
    if brain is None:
        return await _json_response(
            404, {"error": f"brain `{brain_id}` not found or not ready"}
        )(scope, receive, send)

    secret_arn = brain.get("token_secret_arn")
    if not secret_arn:
        return await _json_response(
            503,
            {"error": f"brain `{brain_id}` has no token configured"},
        )(scope, receive, send)

    expected = _load_token(secret_arn)
    if not expected:
        return await _json_response(
            503,
            {"error": f"brain `{brain_id}` token unavailable"},
        )(scope, receive, send)

    presented = _extract_bearer(scope)
    if not presented or presented != expected:
        return await _json_response(
            401,
            {"error": "invalid or missing bearer token"},
        )(scope, receive, send)

    # Rewrite the scope's path so FastMCP's own router matches /mcp routes
    # regardless of whether the client called /mcp or /brain/<id>/mcp.
    new_scope = {**scope, "path": new_path, "raw_path": new_path.encode("latin-1")}

    # Bind the brain into the contextvar for the duration of this request
    # so the tool functions can read it without threading kwargs through
    # FastMCP's tool dispatch machinery.
    token = _current_brain.set(brain)
    try:
        await _mcp_app(new_scope, receive, send)
    finally:
        _current_brain.reset(token)


# Top-level Starlette app — single catch-all mount because we do the
# routing ourselves (path templates with variable segments aren't expressible
# in Starlette's basic router without regex routes, and rolling our own
# dispatch keeps the surface area small).
app = Starlette(routes=[Mount("/", app=_dispatch)])
