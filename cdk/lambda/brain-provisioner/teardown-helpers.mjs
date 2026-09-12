/**
 * Shared teardown predicates / retry used by brain-provisioner.
 * Kept in a side module so unit tests don't have to load AWS clients
 * or the pg-http Lambda layer.
 */

export function isNotFound(err) {
  if (!err) return false;
  const name = err.name || err.Code;
  return (
    name === "NoSuchBucket" ||
    name === "NoSuchKey" ||
    name === "ResourceNotFoundException" ||
    name === "NotFoundException" ||
    name === "NotFound" ||
    name === "NoSuchEntity"
  );
}

export function isConflict(err) {
  if (!err) return false;
  const name = err.name || err.Code;
  return name === "ConflictException";
}

// Bedrock returns ConflictException when a data source / KB is mid-ingest
// (auto-ingest fires StartIngestionJob on the ObjectRemoved events from
// emptyBucket). Retry instead of leaving the registry row stuck in
// `deleting` forever — that is what stranded kamino-cs-findit-amplia-kw4wt
// on 2026-08-31.
export async function withConflictRetry(fn, { attempts = 8, delayMs = 2000 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!isConflict(err)) throw err;
      lastErr = err;
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}
