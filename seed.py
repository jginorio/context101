"""
Seed Team Brain from markdown files in the knowledge/ directory.

Each file becomes a knowledge entry. Subdirectories become tag prefixes.
Run: python seed.py
Requires: VOYAGE_API_KEY env var
"""

import os
from pathlib import Path

from server import store_knowledge, db

KNOWLEDGE_DIR = Path(__file__).parent / "knowledge"


def derive_tags(file_path: Path) -> list[str]:
    """Derive tags from file path relative to knowledge/."""
    rel = file_path.relative_to(KNOWLEDGE_DIR)
    tags = []
    # Add parent directory names as tags
    for part in rel.parent.parts:
        tags.append(part)
    # Add filename (without .md) as a tag
    tags.append(rel.stem)
    return tags


def derive_title(file_path: Path) -> str:
    """Derive a title from filename."""
    return file_path.stem.replace("-", " ").replace("_", " ").title()


def main():
    # Clear existing entries
    db.execute("DELETE FROM knowledge")
    db.execute("DELETE FROM knowledge_fts")
    db.commit()
    print("Cleared existing entries.\n")

    md_files = sorted(KNOWLEDGE_DIR.rglob("*.md"))
    if not md_files:
        print(f"No .md files found in {KNOWLEDGE_DIR}")
        return

    for f in md_files:
        title = derive_title(f)
        content = f.read_text().strip()
        tags = derive_tags(f)

        print(f"Indexing: {f.relative_to(KNOWLEDGE_DIR)}")
        print(f"  Title: {title}")
        print(f"  Tags:  {tags}")
        print(f"  Size:  {len(content)} chars")

        result = store_knowledge(
            title=title,
            content=content,
            tags=tags,
            author="seed",
        )
        print(f"  Done.\n")

    print(f"Seeded Team Brain with {len(md_files)} entries from {KNOWLEDGE_DIR}")


if __name__ == "__main__":
    main()
