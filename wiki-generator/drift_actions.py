"""
Drift write-back (Phase 4).

The wiki generator detects source conflicts (Level 1 within-page, Level 3
cross-page) and queues them as drift findings. This module decides what — if
anything — to do with those findings at the source: comment on the Notion page
or Google Doc, open a GitHub issue, etc.

Default posture is deliberately inert:
  - WIKI_DRIFT_WRITEBACK off  → log only, take no external action.
  - WIKI_DRIFT_DRYRUN on      → even when write-back is enabled, only log the
                                actions that *would* be taken.

Guardrails baked in from the start so enabling live actions later is safe:
  - Stable `finding_id` dedup: already-actioned findings (persisted in
    {WIKI_PREFIX}_drift_actioned.json) are skipped so we never re-comment the
    same conflict every run.
  - Per-run volume cap (DRIFT_ACTION_CAP) so a noisy run can't spray hundreds
    of comments.

Real adapters are intentionally NOT implemented here: live actions require the
Fargate task to be granted the connector secrets (a deploy prerequisite), which
is out of scope for this change. The adapter functions log their intent so the
routing is exercisable end-to-end in dry-run.
"""

import json
import os
import sys

import boto3
from botocore.config import Config

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
AWS_PROFILE = os.environ.get("AWS_PROFILE")
DOCS_BUCKET = os.environ.get("DOCS_BUCKET")
WIKI_PREFIX = os.environ.get("WIKI_PREFIX", "wiki/")
if not WIKI_PREFIX.endswith("/"):
    WIKI_PREFIX += "/"

# Max external actions per run. Keeps a noisy regen from spamming sources.
DRIFT_ACTION_CAP = int(os.environ.get("DRIFT_ACTION_CAP", "20"))

_ACTIONED_KEY = f"{WIKI_PREFIX}_drift_actioned.json"

_session = boto3.Session(region_name=AWS_REGION, profile_name=AWS_PROFILE)
_s3 = _session.client(
    "s3", config=Config(retries={"max_attempts": 5, "mode": "adaptive"})
)


def _log(msg: str) -> None:
    print(f"  [drift] {msg}", file=sys.stderr)


def _load_actioned() -> set[str]:
    """Finding ids already actioned in a prior run (so we don't repeat)."""
    if not DOCS_BUCKET:
        return set()
    try:
        obj = _s3.get_object(Bucket=DOCS_BUCKET, Key=_ACTIONED_KEY)
        data = json.loads(obj["Body"].read().decode("utf-8"))
        return set(data.get("finding_ids", []))
    except Exception:
        return set()


def _save_actioned(ids: set[str]) -> None:
    if not DOCS_BUCKET:
        return
    try:
        _s3.put_object(
            Bucket=DOCS_BUCKET,
            Key=_ACTIONED_KEY,
            Body=json.dumps({"finding_ids": sorted(ids)}, indent=2).encode("utf-8"),
            ContentType="application/json",
        )
    except Exception as e:  # never fail the run over the dedup ledger
        _log(f"couldn't persist actioned ledger: {e}")


# ── Adapters (stubs) ──────────────────────────────────────────────────
# Each returns True if it "handled" the finding. Live implementations need the
# corresponding connector secret granted to the task — not wired here.


def _route(finding: dict) -> bool:
    """Pick an adapter from the finding's source urls/keys and log intent.

    Returns True when a route was found (counts against the volume cap)."""
    urls = finding.get("source_urls") or []
    keys = finding.get("conflicting_keys") or []
    target = urls[0] if urls else (keys[0] if keys else "?")

    # Coarse routing by source key prefix / url — mirrors the connector layout.
    joined = " ".join(urls + keys)
    if "notion" in joined:
        kind = "Notion comment"
    elif "docs.google" in joined or "/docs/" in joined:
        kind = "Google Doc comment"
    elif "github" in joined or joined.startswith("sources/github/"):
        kind = "GitHub issue"
    else:
        kind = "review-queue entry"

    _log(f"would create {kind} on {target}: {finding.get('description', '')[:120]}")
    return True


def dispatch(findings: list[dict], *, enabled: bool, dry_run: bool) -> dict:
    """Act on drift findings according to the write-back flags.

    Returns a small summary dict (also handy for tests). Default flags make
    this log-only and side-effect-free apart from the dedup ledger write."""
    if not findings:
        return {"considered": 0, "actioned": 0, "skipped_seen": 0, "capped": 0}

    actioned_before = _load_actioned()
    seen = 0
    newly: set[str] = set()
    capped = 0

    for finding in findings:
        fid = finding.get("finding_id", "")
        if fid and fid in actioned_before:
            seen += 1
            continue
        if len(newly) >= DRIFT_ACTION_CAP:
            capped += 1
            continue

        if not enabled:
            _log(
                f"write-back disabled — would handle {fid}: "
                f"{finding.get('description', '')[:120]}"
            )
        elif dry_run:
            _log(f"[dry-run] {fid}")
            _route(finding)
        else:
            if _route(finding):
                newly.add(fid)

    # In live mode, persist what we actioned so the next run skips it. Dry-run
    # and disabled modes never mutate the ledger.
    if enabled and not dry_run and newly:
        _save_actioned(actioned_before | newly)

    summary = {
        "considered": len(findings),
        "actioned": len(newly),
        "skipped_seen": seen,
        "capped": capped,
    }
    _log(
        f"dispatch summary: {summary} "
        f"(enabled={enabled}, dry_run={dry_run}, cap={DRIFT_ACTION_CAP})"
    )
    return summary
