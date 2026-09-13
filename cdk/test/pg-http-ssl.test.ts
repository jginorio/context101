import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const load = createRequire(__filename);
const {
  isNeonConnectionString,
  sslOptionForTcp,
  tcpClientConfig,
  connectionStringForPgClient,
} = load("../layers/pg-http/nodejs/pg-http/index.js") as {
  isNeonConnectionString: (url: string) => boolean;
  sslOptionForTcp: (url: string) => false | { rejectUnauthorized: false };
  tcpClientConfig: (url: string) => {
    connectionString: string;
    ssl: false | { rejectUnauthorized: false };
    types: { getTypeParser: () => (val: unknown) => unknown };
  };
  connectionStringForPgClient: (url: string) => string;
};

const RDS_REQUIRE =
  "postgresql://context101:secret@context101.xxxx.rds.amazonaws.com:5432/context101?sslmode=require";

/**
 * node-pg 8.16.3 (`pg-connection-string`) without uselibpqcompat:
 * sslmode=require → ssl: {} (empty). ConnectionParameters then does
 * Object.assign({}, config, parse(connectionString)), so this empty
 * object replaces an explicit rejectUnauthorized: false. Node TLS
 * treats {} as verify (rejectUnauthorized defaults true).
 */
function pgParsedSsl(connectionString: string) {
  const url = new URL(connectionString);
  const mode = url.searchParams.get("sslmode");
  if (!mode) return undefined;
  if (mode === "disable") return false;
  if (mode === "no-verify") return { rejectUnauthorized: false };
  return {};
}

function pgEffectiveSsl(config: {
  connectionString: string;
  ssl?: false | { rejectUnauthorized: boolean };
}) {
  const parsedSsl = pgParsedSsl(config.connectionString);
  const merged = Object.assign(
    {},
    config,
    parsedSsl === undefined ? {} : { ssl: parsedSsl }
  );
  return merged.ssl;
}

test("RDS hosts stay on the TCP path", () => {
  assert.equal(isNeonConnectionString(RDS_REQUIRE), false);
  assert.equal(
    isNeonConnectionString("postgresql://u:p@ep-x.aws.neon.tech/db"),
    true
  );
});

test("sslmode=require does not enable cert verification that rejects RDS", () => {
  assert.deepEqual(sslOptionForTcp(RDS_REQUIRE), { rejectUnauthorized: false });

  const naive = {
    connectionString: RDS_REQUIRE,
    ssl: { rejectUnauthorized: false } as const,
  };
  assert.deepEqual(pgEffectiveSsl(naive), {});

  const config = tcpClientConfig(RDS_REQUIRE);
  assert.deepEqual(config.ssl, { rejectUnauthorized: false });
  assert.equal(/sslmode=/i.test(config.connectionString), false);
  assert.deepEqual(pgEffectiveSsl(config), { rejectUnauthorized: false });
  assert.match(
    config.connectionString,
    /rds\.amazonaws\.com:5432\/context101/
  );
});

test("sslmode=disable turns TLS off; other modes keep encryption without verify", () => {
  assert.equal(
    sslOptionForTcp("postgresql://u:p@localhost:5432/db?sslmode=disable"),
    false
  );
  assert.deepEqual(
    sslOptionForTcp("postgresql://u:p@localhost:5432/db?sslmode=no-verify"),
    { rejectUnauthorized: false }
  );
  assert.deepEqual(
    sslOptionForTcp("postgresql://u:p@localhost:5432/db"),
    { rejectUnauthorized: false }
  );
  assert.equal(
    connectionStringForPgClient(
      "postgresql://u:p@localhost:5432/db?sslmode=require&application_name=ctx"
    ).includes("application_name=ctx"),
    true
  );
});

test("CREATE_RDS URL still asks for sslmode=require (postgres-js)", async () => {
  const src = await readFile(
    path.resolve(__dirname, "..", "lib", "control-plane-db.ts"),
    "utf8"
  );
  assert.match(src, /\?sslmode=require/);
  assert.doesNotMatch(src, /sslmode=no-verify/);
  assert.doesNotMatch(src, /sslmode=disable/);
});
