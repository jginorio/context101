"""
Upload local knowledge/ files to the S3 docs bucket.

After the upload, the auto-ingest Lambda will trigger a Bedrock KB
ingestion job automatically. Allow ~1-3 minutes for indexing to complete.

Usage:
    DOCS_BUCKET=team-brain-docs-xxxxx python upload.py
    # or use AWS_PROFILE if you use multiple AWS accounts:
    AWS_PROFILE=plateapr.com DOCS_BUCKET=team-brain-docs-xxxxx python upload.py
"""

import os
import sys
from pathlib import Path

import boto3

KNOWLEDGE_DIR = Path(__file__).parent / "knowledge"
DOCS_BUCKET = os.environ.get("DOCS_BUCKET")
AWS_PROFILE = os.environ.get("AWS_PROFILE")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")


def main() -> int:
    if not DOCS_BUCKET:
        print("ERROR: DOCS_BUCKET env var is required.", file=sys.stderr)
        print(
            "Get it from `cdk deploy` outputs, then run: "
            "DOCS_BUCKET=<name> python upload.py",
            file=sys.stderr,
        )
        return 1

    if not KNOWLEDGE_DIR.exists():
        print(f"ERROR: {KNOWLEDGE_DIR} does not exist.", file=sys.stderr)
        return 1

    session = boto3.Session(region_name=AWS_REGION, profile_name=AWS_PROFILE)
    s3 = session.client("s3")

    md_files = sorted(KNOWLEDGE_DIR.rglob("*.md"))
    if not md_files:
        print(f"No .md files found in {KNOWLEDGE_DIR}")
        return 0

    print(f"Uploading {len(md_files)} files to s3://{DOCS_BUCKET}/\n")

    for f in md_files:
        key = str(f.relative_to(KNOWLEDGE_DIR))
        print(f"  {key}  ({f.stat().st_size} bytes)")
        s3.upload_file(str(f), DOCS_BUCKET, key, ExtraArgs={"ContentType": "text/markdown"})

    print(
        f"\nUploaded {len(md_files)} file(s). "
        "The auto-ingest Lambda has been triggered; wait ~1-3 min for "
        "the Bedrock KB to finish indexing."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
