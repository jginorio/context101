import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HOSTED_PROVISION_HEADER,
  hostedProvisionGate,
  hostedProvisionSecretsEqual,
  presentedHostedProvisionSecret,
} from "./secret";

function headers(init: Record<string, string>): Pick<Headers, "get"> {
  const normalized = Object.fromEntries(
    Object.entries(init).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    get(name) {
      return normalized[name.toLowerCase()] ?? null;
    },
  };
}

test("reads x-hosted-provision-secret before Authorization", () => {
  assert.equal(
    presentedHostedProvisionSecret(
      headers({
        [HOSTED_PROVISION_HEADER]: "dedicated",
        authorization: "Bearer bearer-token",
      })
    ),
    "dedicated"
  );
});

test("reads Authorization Bearer when the dedicated header is absent", () => {
  assert.equal(
    presentedHostedProvisionSecret(headers({ authorization: "Bearer abc" })),
    "abc"
  );
  assert.equal(
    presentedHostedProvisionSecret(headers({ authorization: "bearer abc" })),
    "abc"
  );
  assert.equal(presentedHostedProvisionSecret(headers({})), null);
  assert.equal(
    presentedHostedProvisionSecret(headers({ authorization: "Basic abc" })),
    null
  );
});

test("compares secrets in constant time and rejects length mismatches", () => {
  assert.equal(hostedProvisionSecretsEqual("same-secret", "same-secret"), true);
  assert.equal(hostedProvisionSecretsEqual("same-secret", "diff-secret"), false);
  assert.equal(hostedProvisionSecretsEqual("short", "much-longer"), false);
});

test("gate refuses self-host, missing secret, and bad credentials", () => {
  assert.deepEqual(
    hostedProvisionGate({
      isHosted: false,
      expectedSecret: "s",
      presentedSecret: "s",
      hasDatabase: true,
    }),
    { ok: false, status: 403, error: "hosted provision is disabled" }
  );
  assert.deepEqual(
    hostedProvisionGate({
      isHosted: true,
      expectedSecret: "",
      presentedSecret: "s",
      hasDatabase: true,
    }),
    {
      ok: false,
      status: 503,
      error: "HOSTED_PROVISION_SECRET is not configured",
    }
  );
  assert.deepEqual(
    hostedProvisionGate({
      isHosted: true,
      expectedSecret: "expected",
      presentedSecret: null,
      hasDatabase: true,
    }),
    { ok: false, status: 401, error: "unauthorized" }
  );
  assert.deepEqual(
    hostedProvisionGate({
      isHosted: true,
      expectedSecret: "expected",
      presentedSecret: "wrong",
      hasDatabase: true,
    }),
    { ok: false, status: 401, error: "unauthorized" }
  );
  assert.deepEqual(
    hostedProvisionGate({
      isHosted: true,
      expectedSecret: "expected",
      presentedSecret: "expected",
      hasDatabase: false,
    }),
    { ok: false, status: 503, error: "DATABASE_URL is not configured" }
  );
  assert.deepEqual(
    hostedProvisionGate({
      isHosted: true,
      expectedSecret: "expected",
      presentedSecret: "expected",
      hasDatabase: true,
    }),
    { ok: true }
  );
});
