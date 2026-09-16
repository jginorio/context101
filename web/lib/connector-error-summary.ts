const SUMMARY_MAX = 96;

function collapseWs(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max = SUMMARY_MAX): string {
  const text = collapseWs(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return asRecord(JSON.parse(raw.slice(start, end + 1)));
  } catch {
    return null;
  }
}

function quotedField(raw: string, key: string): string | null {
  const match = raw.match(
    new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`)
  );
  if (!match?.[1]) return null;
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1];
  }
}

function stringField(
  obj: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function httpStatus(
  obj: Record<string, unknown> | null,
  raw: string
): string | null {
  if (obj) {
    for (const key of ["status", "statusCode", "code"]) {
      const value = obj[key];
      if (typeof value === "number" && value >= 100 && value <= 599) {
        return String(value);
      }
      if (typeof value === "string" && /^\d{3}$/.test(value)) return value;
    }
  }
  return raw.match(/\b([1-5]\d{2})\b/)?.[1] ?? null;
}

function errorCode(
  obj: Record<string, unknown> | null,
  raw: string
): string | null {
  const candidates: unknown[] = obj ? [obj.code, obj.status] : [];
  candidates.push(quotedField(raw, "code"), quotedField(raw, "status"));
  for (const value of candidates) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (!text || /^\d{3}$/.test(text)) continue;
    return text.replace(/_/g, " ");
  }
  return null;
}

function unwrapErrorObject(
  obj: Record<string, unknown>
): Record<string, unknown> {
  const nested = asRecord(obj.error);
  return nested ?? obj;
}

/** One-line label for a connector `last_error` blob. */
export function summarizeConnectorError(raw: string): string {
  const text = collapseWs(raw);
  if (!text) return "Sync failed";

  const parsed = parseJsonObject(raw);
  const obj = parsed ? unwrapErrorObject(parsed) : null;
  const message =
    (obj &&
      stringField(obj, [
        "message",
        "error_description",
        "errorMessage",
        "detail",
        "error",
      ])) ||
    quotedField(raw, "message");
  const status = httpStatus(obj, raw);
  const code = errorCode(obj, raw);

  const head: string[] = [];
  if (status) head.push(status);
  if (
    code &&
    (!message || !message.toLowerCase().includes(code.toLowerCase()))
  ) {
    head.push(code);
  }

  if (message) {
    const prefix = head.length ? `${head.join(" ")} — ` : "";
    return truncate(`${prefix}${message}`);
  }
  if (head.length) return truncate(head.join(" "));

  const withoutJson = collapseWs(
    raw.replace(/\{[\s\S]*$/, "").replace(/[:\-–—]\s*$/, "")
  );
  return truncate(withoutJson || text);
}
