/**
 * Python-compatible JSON serialization.
 *
 * The Python generator writes JSON with `json.dumps`, whose defaults differ
 * from JavaScript's `JSON.stringify` in two ways that matter for diffing:
 *   1. `ensure_ascii=True` — non-ASCII chars are escaped to \uXXXX.
 *   2. The compact item separator is ", " (with a space), and the key/value
 *      separator is ": " — both with indent and without.
 *
 * Replicating these keeps `_index.json` / `_meta.json` / the sidecars
 * byte-comparable with the Python output (modulo inherently nondeterministic
 * fields like timestamps and the LLM-authored page bodies).
 */

function pyStr(s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    switch (ch) {
      case '"':
        out += '\\"';
        break;
      case "\\":
        out += "\\\\";
        break;
      case "\n":
        out += "\\n";
        break;
      case "\r":
        out += "\\r";
        break;
      case "\t":
        out += "\\t";
        break;
      case "\b":
        out += "\\b";
        break;
      case "\f":
        out += "\\f";
        break;
      default:
        if (cp < 0x20) {
          out += "\\u" + cp.toString(16).padStart(4, "0");
        } else if (cp < 0x80) {
          out += ch;
        } else if (cp > 0xffff) {
          // ensure_ascii: emit a UTF-16 surrogate pair, matching CPython.
          const c = cp - 0x10000;
          const hi = 0xd800 + (c >> 10);
          const lo = 0xdc00 + (c & 0x3ff);
          out +=
            "\\u" +
            hi.toString(16).padStart(4, "0") +
            "\\u" +
            lo.toString(16).padStart(4, "0");
        } else {
          out += "\\u" + cp.toString(16).padStart(4, "0");
        }
    }
  }
  return out + '"';
}

function encode(v: unknown, indent: number | null, level: number): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`Cannot serialize ${v} to JSON`);
    return String(v);
  }
  if (typeof v === "string") return pyStr(v);

  const nl = indent != null ? "\n" : "";
  const pad = indent != null ? " ".repeat(indent * (level + 1)) : "";
  const padEnd = indent != null ? " ".repeat(indent * level) : "";
  const itemSep = indent != null ? "," : ", ";

  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    const items = v.map((x) => pad + encode(x, indent, level + 1));
    return "[" + nl + items.join(itemSep + nl) + nl + padEnd + "]";
  }

  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return "{}";
  const items = keys.map(
    (k) => pad + pyStr(k) + ": " + encode(obj[k], indent, level + 1)
  );
  return "{" + nl + items.join(itemSep + nl) + nl + padEnd + "}";
}

/** Serialize like Python's json.dumps. Pass `indent` for pretty output. */
export function pyDumps(value: unknown, indent: number | null = null): string {
  return encode(value, indent, 0);
}
