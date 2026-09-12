import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  formatAccessResult,
  parseAvailability,
  pickOfferToken,
  requestEmbeddingModelAccess,
} from "../src/bedrock-access.js";
import { fallbackEmbeddingModels } from "../src/embedding-models.js";
import { main } from "../src/main.js";
import { fakeExec, makeRepoFixture, memoryIo, testEnv } from "./helpers.js";

const OFFER_TOKEN = "offer-token-must-never-appear";

test("parseAvailability treats agreement or entitlement AVAILABLE as available", () => {
  assert.equal(
    parseAvailability({ agreementAvailability: { status: "AVAILABLE" } }).available,
    true
  );
  assert.equal(
    parseAvailability({ entitlementAvailability: "AVAILABLE" }).available,
    true
  );
  assert.equal(
    parseAvailability({ agreementAvailability: { status: "NOT_AVAILABLE" } })
      .available,
    false
  );
});

test("pickOfferToken prefers PUBLIC and never requires printing the token", () => {
  assert.equal(pickOfferToken({ offers: [] }), "");
  assert.equal(
    pickOfferToken({
      offers: [
        { offerType: "PRIVATE", offerToken: "private-must-never-appear" },
        { offerType: "PUBLIC", offerToken: OFFER_TOKEN },
      ],
    }),
    OFFER_TOKEN
  );
});

test("requestEmbeddingModelAccess skips Amazon and agreements when already available", () => {
  const calls = [];
  const exec = ({ command, args }) => {
    calls.push([command, args[1], args[args.indexOf("--model-id") + 1] || ""]);
    return fakeExec()({ command, args });
  };
  const results = requestEmbeddingModelAccess({
    exec,
    env: {},
    region: "xx-test-1",
    models: fallbackEmbeddingModels(),
  });
  assert.equal(results.length, 7);
  assert.equal(
    results.filter((row) => row.status === "first-party").length,
    3
  );
  assert.equal(
    results.filter((row) => row.status === "already-available").length,
    4
  );
  assert.equal(
    calls.some((call) => call[1] === "create-foundation-model-agreement"),
    false
  );
  assert.equal(
    calls.some((call) => call[0] === "aws" && String(call[2]).startsWith("amazon.")),
    false
  );
});

test("requestEmbeddingModelAccess creates a Cohere agreement without exposing the token", () => {
  const created = [];
  const inner = fakeExec({
    bedrockAvailability: { "cohere.embed-english-v3": "NOT_AVAILABLE" },
  });
  const exec = (spec) => {
    if (spec.args?.[1] === "create-foundation-model-agreement") {
      created.push(spec.args[spec.args.indexOf("--model-id") + 1]);
    }
    return inner(spec);
  };
  const results = requestEmbeddingModelAccess({
    exec,
    env: {},
    region: "xx-test-1",
    models: [
      { id: "amazon.titan-embed-text-v2:0", provider: "aws" },
      { id: "cohere.embed-english-v3", provider: "cohere" },
    ],
  });
  assert.deepEqual(
    results.map((row) => row.status),
    ["first-party", "granted"]
  );
  assert.deepEqual(created, ["cohere.embed-english-v3"]);
  const printed = results.map(formatAccessResult).join("\n");
  assert.equal(printed.includes(OFFER_TOKEN), false);
  assert.match(printed, /access granted/);
});

test("dry-run --skip-bedrock-access does not request access", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-dry-skip-bed-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  let created = false;

  const code = await main(["init", "--dry-run", "--skip-bedrock-access"], {
    cwd: root,
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
    exec: (spec) => {
      if (spec.args?.[1] === "create-foundation-model-agreement") created = true;
      return fakeExec()(spec);
    },
  });

  assert.equal(code, 0);
  assert.equal(created, false);
  assert.match(io.stdoutText, /skip requesting access/);
  assert.equal(io.stdoutText.includes("request access for all"), false);
});

test("--yes requests access for every embedding model and does not create agreements when available", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-yes-bed-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const created = [];
  const availability = [];

  const code = await main(
    ["init", "--yes", "--database-url", "postgresql://localhost/db", "--force"],
    {
      cwd: root,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: (spec) => {
        if (spec.args?.[1] === "get-foundation-model-availability") {
          availability.push(spec.args[spec.args.indexOf("--model-id") + 1]);
        }
        if (spec.args?.[1] === "create-foundation-model-agreement") {
          created.push(spec.args[spec.args.indexOf("--model-id") + 1]);
        }
        return fakeExec()(spec);
      },
    }
  );

  assert.equal(code, 0);
  assert.deepEqual(created, []);
  assert.equal(availability.includes("amazon.titan-embed-text-v2:0"), false);
  assert.equal(availability.includes("cohere.embed-english-v3"), true);
  assert.equal(availability.includes("cohere.embed-english-light-v3"), true);
  const text = `${io.stdoutText}\n${io.stderrText}`;
  assert.match(text, /Bedrock embedding access:/);
  assert.match(text, /Amazon \(auto-enabled\)/);
  assert.match(text, /already available/);
  assert.equal(text.includes(OFFER_TOKEN), false);
});

test("--yes creates a Cohere agreement and never prints the offer token", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-yes-agree-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  const created = [];
  const inner = fakeExec({
    bedrockAvailability: {
      "cohere.embed-english-v3": "NOT_AVAILABLE",
      "cohere.embed-multilingual-v3": "NOT_AVAILABLE",
      "cohere.embed-english-light-v3": "NOT_AVAILABLE",
      "cohere.embed-multilingual-light-v3": "NOT_AVAILABLE",
    },
  });

  const code = await main(
    ["init", "--yes", "--database-url", "postgresql://localhost/db", "--force"],
    {
      cwd: root,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: (spec) => {
        if (spec.args?.[1] === "create-foundation-model-agreement") {
          created.push(spec.args[spec.args.indexOf("--model-id") + 1]);
        }
        return inner(spec);
      },
    }
  );

  assert.equal(code, 0);
  assert.deepEqual(created.sort(), [
    "cohere.embed-english-light-v3",
    "cohere.embed-english-v3",
    "cohere.embed-multilingual-light-v3",
    "cohere.embed-multilingual-v3",
  ]);
  const text = `${io.stdoutText}\n${io.stderrText}`;
  assert.match(text, /access granted/);
  assert.equal(text.includes(OFFER_TOKEN), false);
  assert.equal(JSON.stringify(created).includes(OFFER_TOKEN), false);
});

test("--yes --skip-bedrock-access does not call agreement APIs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ctx101-yes-skip-bed-"));
  await makeRepoFixture(root);
  const io = memoryIo();
  let availabilityCalls = 0;
  let created = false;

  const code = await main(
    [
      "init",
      "--yes",
      "--skip-bedrock-access",
      "--database-url",
      "postgresql://localhost/db",
      "--force",
    ],
    {
      cwd: root,
      env: testEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
      stdin: io.stdin,
      exec: (spec) => {
        if (spec.args?.[1] === "get-foundation-model-availability") {
          availabilityCalls += 1;
        }
        if (spec.args?.[1] === "create-foundation-model-agreement") created = true;
        return fakeExec()(spec);
      },
    }
  );

  assert.equal(code, 0);
  assert.equal(availabilityCalls, 0);
  assert.equal(created, false);
  assert.equal(io.stdoutText.includes("Bedrock embedding access:"), false);
});
