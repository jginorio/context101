"""
Team Brain — Shared team knowledge base via MCP.

Tools:
  - store_knowledge: Add knowledge with title, content, tags, author
  - search_knowledge: Semantic search — returns titles + snippets + IDs
  - read_knowledge: Fetch full content of a specific entry by ID
  - list_tags: Browse what's in the knowledge base
  - delete_knowledge: Remove an entry by ID

Stack:
  - FastMCP (Python) for MCP protocol
  - Voyage AI (voyage-3.5) for embeddings
  - SQLite for metadata + FTS5 fallback
  - NumPy for cosine similarity
"""

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import voyageai
from fastmcp import FastMCP

# ── Config ────────────────────────────────────────────────────────────

DATA_DIR = Path(os.environ.get("TEAM_BRAIN_DATA_DIR", Path.home() / ".team-brain"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "team-brain.db"

VOYAGE_MODEL = os.environ.get("TEAM_BRAIN_EMBED_MODEL", "voyage-3.5")
EMBED_DIM = 1024  # voyage-3.5 default

# ── Voyage client ─────────────────────────────────────────────────────

voyage = voyageai.Client()  # reads VOYAGE_API_KEY from env


def embed_documents(texts: list[str]) -> list[list[float]]:
    """Embed a list of texts as documents."""
    result = voyage.embed(texts, model=VOYAGE_MODEL, input_type="document")
    return result.embeddings


def embed_query(text: str) -> list[float]:
    """Embed a single query."""
    result = voyage.embed([text], model=VOYAGE_MODEL, input_type="query")
    return result.embeddings[0]


# ── Database ──────────────────────────────────────────────────────────


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS knowledge (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            tags TEXT NOT NULL DEFAULT '[]',
            author TEXT NOT NULL DEFAULT 'anonymous',
            embedding BLOB,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
            title, content, tags,
            content=knowledge, content_rowid=rowid
        );

        CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge BEGIN
            INSERT INTO knowledge_fts(rowid, title, content, tags)
            VALUES (new.rowid, new.title, new.content, new.tags);
        END;

        CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge BEGIN
            INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, tags)
            VALUES ('delete', old.rowid, old.title, old.content, old.tags);
        END;

        CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE ON knowledge BEGIN
            INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, tags)
            VALUES ('delete', old.rowid, old.title, old.content, old.tags);
            INSERT INTO knowledge_fts(rowid, title, content, tags)
            VALUES (new.rowid, new.title, new.content, new.tags);
        END;
    """)
    return conn


db = get_db()


# ── Auto-seed from knowledge/ on first run ───────────────────────────

def _auto_seed():
    """If DB is empty, index all .md files from knowledge/ directory."""
    count = db.execute("SELECT COUNT(*) FROM knowledge").fetchone()[0]
    if count > 0:
        return

    knowledge_dir = Path(__file__).parent / "knowledge"
    if not knowledge_dir.exists():
        return

    md_files = sorted(knowledge_dir.rglob("*.md"))
    if not md_files:
        return

    import sys
    print(f"Auto-seeding from {len(md_files)} knowledge files...", file=sys.stderr)

    for f in md_files:
        rel = f.relative_to(knowledge_dir)
        tags = [p for p in rel.parent.parts] + [rel.stem]
        title = f.stem.replace("-", " ").replace("_", " ").title()
        content = f.read_text().strip()

        entry_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        embedding = embed_documents([f"{title}\n\n{content}"])[0]

        db.execute(
            """INSERT INTO knowledge (id, title, content, tags, author, embedding, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (entry_id, title, content, json.dumps(tags), "seed", _vec_to_bytes(embedding), now, now),
        )

    db.commit()
    print(f"Auto-seeded {len(md_files)} entries.", file=sys.stderr)


# ── Helpers ───────────────────────────────────────────────────────────


def _vec_to_bytes(vec: list[float]) -> bytes:
    return np.array(vec, dtype=np.float32).tobytes()


def _bytes_to_vec(b: bytes) -> np.ndarray:
    return np.frombuffer(b, dtype=np.float32)


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-10))


_auto_seed()

# ── MCP Server ────────────────────────────────────────────────────────

mcp = FastMCP(
    "Team Brain",
    instructions="""You are the librarian for a shared team knowledge base called "Team Brain".

When someone stores knowledge, help them pick clear tags from domains like:
analytics, engineering, product, design, decisions, ops, marketing, finance.

When someone searches, the system uses semantic similarity — so natural language
queries like "why are users leaving the pricing page" will find relevant entries
even if those exact words weren't used.

Workflow: use search_knowledge to find relevant entries (returns summaries),
then use read_knowledge to fetch the full content of specific entries.

Available tools:
- store_knowledge: Add new knowledge to the shared brain
- search_knowledge: Semantic search — returns titles, snippets, and IDs
- read_knowledge: Fetch the full content of an entry by ID
- list_tags: See all tags and how many entries each has
- delete_knowledge: Remove an entry by ID""",
)


@mcp.tool()
def store_knowledge(
    title: str,
    content: str,
    tags: list[str] | None = None,
    author: str = "anonymous",
) -> str:
    """Store a piece of knowledge in the shared team brain.

    Args:
        title: Short descriptive title, e.g. "Q1 2026 Conversion Drop Analysis"
        content: The actual knowledge — insights, decisions, context, specs, etc.
        tags: Categories like ["analytics", "conversion", "q1-2026"]. Use lowercase.
        author: Who is adding this, e.g. "maria", "jake"

    Returns:
        Confirmation with the stored document ID.
    """
    tags = tags or []
    entry_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    # Generate embedding for the combined title + content
    embedding = embed_documents([f"{title}\n\n{content}"])[0]

    db.execute(
        """INSERT INTO knowledge (id, title, content, tags, author, embedding, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            entry_id,
            title,
            content,
            json.dumps(tags),
            author,
            _vec_to_bytes(embedding),
            now,
            now,
        ),
    )
    db.commit()

    return "\n".join([
        "✅ Stored in Team Brain",
        "",
        f"**Title:** {title}",
        f"**ID:** {entry_id}",
        f"**Author:** {author}",
        f"**Tags:** {', '.join(tags) or 'none'}",
        f"**Time:** {now}",
    ])


@mcp.tool()
def search_knowledge(
    query: str,
    tags: list[str] | None = None,
    limit: int = 5,
) -> str:
    """Search the shared team knowledge base using natural language.

    Returns summaries with IDs. Use read_knowledge(id) to get full content.

    The search understands meaning, not just keywords. For example,
    "why are users leaving" will match entries about "bounce rate increase".

    Args:
        query: Natural language search, e.g. "what did analytics find about user drop-off"
        tags: Optional filter to specific tags, e.g. ["analytics", "decisions"]
        limit: Max results to return (default 5, max 20)

    Returns:
        Matching entries with title, snippet, tags, author, and ID.
        Use read_knowledge with the ID to get the full content.
    """
    limit = min(max(limit, 1), 20)

    # Get all entries (with optional tag filter)
    if tags:
        placeholders = " OR ".join(["tags LIKE ?"] * len(tags))
        params = [f'%"{t}"%' for t in tags]
        rows = db.execute(
            f"SELECT * FROM knowledge WHERE {placeholders}", params
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM knowledge").fetchall()

    if not rows:
        return "The knowledge base is empty. Use store_knowledge to add the first entry."

    # Embed the query and compute similarities
    query_vec = np.array(embed_query(query))

    scored = []
    for row in rows:
        if row["embedding"] is None:
            continue
        doc_vec = _bytes_to_vec(row["embedding"])
        score = _cosine_similarity(query_vec, doc_vec)
        scored.append((score, row))

    # Sort by similarity descending
    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:limit]

    if not top:
        all_tags = _get_all_tags()
        return f'No results for "{query}". Available tags: {", ".join(all_tags) or "none"}'

    entries = []
    for i, (score, row) in enumerate(top, 1):
        row_tags = json.loads(row["tags"])
        relevance = round(score * 100, 1)
        # Snippet: first 200 chars of content
        snippet = row["content"][:200].replace("\n", " ").strip()
        if len(row["content"]) > 200:
            snippet += "..."
        entries.append("\n".join([
            f"### {i}. {row['title']}",
            f"**Author:** {row['author']} · **Tags:** {', '.join(row_tags)} · **Relevance:** {relevance}%",
            f"**ID:** `{row['id']}`",
            f"**Snippet:** {snippet}",
        ]))

    return (
        f'Found {len(entries)} result(s) for "{query}"\n'
        f"Use read_knowledge(id) to get the full content of any entry.\n\n"
        + "\n\n---\n\n".join(entries)
    )


def _get_all_tags() -> list[str]:
    rows = db.execute("SELECT tags FROM knowledge").fetchall()
    tag_set: set[str] = set()
    for row in rows:
        for tag in json.loads(row["tags"]):
            tag_set.add(tag)
    return sorted(tag_set)


@mcp.tool()
def read_knowledge(id: str) -> str:
    """Read the full content of a knowledge entry by its ID.

    Use this after search_knowledge to get the complete text of an entry.

    Args:
        id: The entry ID (from search results).

    Returns:
        Full entry with title, content, metadata.
    """
    row = db.execute("SELECT * FROM knowledge WHERE id = ?", (id,)).fetchone()
    if not row:
        return f"Entry not found: {id}"

    row_tags = json.loads(row["tags"])
    return "\n".join([
        f"# {row['title']}",
        "",
        f"**Author:** {row['author']}",
        f"**Tags:** {', '.join(row_tags) or 'none'}",
        f"**Created:** {row['created_at'][:10]}",
        f"**Updated:** {row['updated_at'][:10]}",
        f"**ID:** {row['id']}",
        "",
        "---",
        "",
        row["content"],
    ])


@mcp.tool()
def list_tags() -> str:
    """List all tags in the knowledge base with entry counts.

    Useful for discovering what knowledge exists before searching.
    """
    rows = db.execute("SELECT tags FROM knowledge").fetchall()

    if not rows:
        return "The knowledge base is empty. Use store_knowledge to add the first entry."

    counts: dict[str, int] = {}
    for row in rows:
        for tag in json.loads(row["tags"]):
            counts[tag] = counts.get(tag, 0) + 1

    sorted_tags = sorted(counts.items(), key=lambda x: x[1], reverse=True)
    lines = [f"- **{tag}** ({count})" for tag, count in sorted_tags]
    return "**Team Brain — All Tags**\n\n" + "\n".join(lines)


@mcp.tool()
def delete_knowledge(id: str) -> str:
    """Delete a knowledge entry by its ID.

    Args:
        id: The ID of the entry to delete (get this from search results).
    """
    row = db.execute("SELECT title FROM knowledge WHERE id = ?", (id,)).fetchone()
    if not row:
        return f"Entry not found: {id}"

    db.execute("DELETE FROM knowledge WHERE id = ?", (id,))
    db.commit()
    return f'Deleted: "{row["title"]}" ({id})'
