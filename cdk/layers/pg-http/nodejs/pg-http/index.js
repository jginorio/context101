"use strict";

/**
 * pg-http — Postgres helper for Context101 control-plane Lambdas.
 *
 * Neon URLs (*.neon.tech) use Neon's SQL-over-HTTP protocol with fetch.
 * Everything else (RDS, Supabase, local) uses the `pg` driver over TCP.
 * Both paths return raw-text cell values so callers stay driver-agnostic:
 * JSON/JSONB arrive as strings (callers JSON.parse), integers as numeric
 * strings (callers Number() when needed).
 */

function isNeonConnectionString(connectionString) {
  try {
    const host = new URL(connectionString).hostname.toLowerCase();
    return host === "neon.tech" || host.endsWith(".neon.tech");
  } catch {
    return false;
  }
}

function endpointFromConnectionString(connectionString) {
  const u = new URL(connectionString);
  const apiHost = u.hostname.replace(/^[^.]+\./, "api.");
  return `https://${apiHost}/sql`;
}

function prepareParam(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function rawTextTypes() {
  return { getTypeParser: () => (val) => val };
}

/**
 * libpq `sslmode` on the URL. `pg` parses this *after* Client options
 * (`Object.assign({}, config, parse(connectionString))`), so an explicit
 * `ssl: { rejectUnauthorized: false }` is discarded. `sslmode=require`
 * becomes `ssl: {}`, and Node TLS then defaults to verify — which dies
 * on public RDS (`self-signed certificate in certificate chain`).
 */
function sslmodeFromConnectionString(connectionString) {
  try {
    return new URL(connectionString).searchParams.get("sslmode") || "";
  } catch {
    const match = String(connectionString).match(/[?&]sslmode=([^&]*)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }
}

function sslOptionForTcp(connectionString) {
  const mode = sslmodeFromConnectionString(connectionString).toLowerCase();
  if (mode === "disable") return false;
  // require / prefer / no-verify / verify-* / unset: encrypt, do not
  // verify Amazon RDS's CA (not in Node's default trust store).
  return { rejectUnauthorized: false };
}

function connectionStringForPgClient(connectionString) {
  try {
    const url = new URL(connectionString);
    if (!url.searchParams.has("sslmode")) return connectionString;
    url.searchParams.delete("sslmode");
    return url.toString();
  } catch {
    return String(connectionString)
      .replace(/([?&])sslmode=[^&]*/gi, "$1")
      .replace(/\?&/, "?")
      .replace(/[?&]$/, "");
  }
}

function tcpClientConfig(connectionString) {
  return {
    connectionString: connectionStringForPgClient(connectionString),
    ssl: sslOptionForTcp(connectionString),
    types: rawTextTypes(),
  };
}

async function pgQueryNeon(connectionString, query, params = []) {
  const res = await fetch(endpointFromConnectionString(connectionString), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Neon-Connection-String": connectionString,
      "Neon-Raw-Text-Output": "true",
      "Neon-Array-Mode": "true",
    },
    body: JSON.stringify({ query, params: params.map(prepareParam) }),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j.message || JSON.stringify(j);
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(`Neon HTTP ${res.status}: ${detail}`);
  }

  const data = await res.json();
  const fieldNames = (data.fields || []).map((f) => f.name);
  const rows = (data.rows || []).map((arr) => {
    const obj = {};
    for (let i = 0; i < fieldNames.length; i++) {
      obj[fieldNames[i]] = arr[i] === undefined ? null : arr[i];
    }
    return obj;
  });

  return { rows, rowCount: data.rowCount ?? rows.length };
}

async function pgQueryTcp(connectionString, query, params = []) {
  let Client;
  try {
    ({ Client } = require("pg"));
  } catch {
    throw new Error(
      "pg is not installed in the Lambda layer — cannot open a TCP Postgres connection"
    );
  }
  const client = new Client(tcpClientConfig(connectionString));
  await client.connect();
  try {
    const result = await client.query(query, params.map(prepareParam));
    return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
  } finally {
    await client.end().catch(() => {});
  }
}

async function pgQuery(connectionString, query, params = []) {
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  if (isNeonConnectionString(connectionString)) {
    return pgQueryNeon(connectionString, query, params);
  }
  return pgQueryTcp(connectionString, query, params);
}

async function pgFetchOne(connectionString, query, params = []) {
  const { rows } = await pgQuery(connectionString, query, params);
  return rows[0] ?? null;
}

async function pgExecute(connectionString, query, params = []) {
  const { rowCount } = await pgQuery(connectionString, query, params);
  return rowCount;
}

module.exports = {
  pgQuery,
  pgFetchOne,
  pgExecute,
  isNeonConnectionString,
  sslOptionForTcp,
  tcpClientConfig,
  connectionStringForPgClient,
};
