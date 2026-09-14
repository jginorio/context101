import assert from "node:assert/strict";
import { test } from "node:test";

import { handleHostedProvisionRequest, type HostedProvisionHttpDeps } from "./http";
import type { HostedProvisionResult } from "./provision";

const SECRET = "test-hosted-provision-secret";

function request(init: {
  headers?: Record<string, string>;
  body?: unknown;
}): Request {
  return new Request("http://localhost/api/internal/hosted-provision", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(init.body ?? { email: "owner@example.com" }),
  });
}

function deps(
  overrides: Partial<HostedProvisionHttpDeps> = {}
): HostedProvisionHttpDeps {
  return {
    isHosted: true,
    expectedSecret: SECRET,
    hasDatabase: true,
    appUrl: "https://app.example.test",
    provision: async () =>
      ({
        ok: true,
        organizationId: "org-1",
        userId: "user-1",
        createdUser: true,
        createdOrganization: true,
        loginUrl: "https://app.example.test/login",
        nextStep: "password_reset",
      }) satisfies HostedProvisionResult,
    ...overrides,
  };
}

test("POST handler returns 403 when APP_MODE is not hosted", async () => {
  const res = await handleHostedProvisionRequest(
    request({ headers: { authorization: `Bearer ${SECRET}` } }),
    deps({ isHosted: false })
  );
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: "hosted provision is disabled" });
});

test("POST handler returns 401 when the shared secret is missing or wrong", async () => {
  const missing = await handleHostedProvisionRequest(request({}), deps());
  assert.equal(missing.status, 401);
  const wrong = await handleHostedProvisionRequest(
    request({ headers: { authorization: "Bearer nope" } }),
    deps()
  );
  assert.equal(wrong.status, 401);
});

test("POST handler returns 400 for a bad body after auth succeeds", async () => {
  const res = await handleHostedProvisionRequest(
    request({
      headers: { "x-hosted-provision-secret": SECRET },
      body: { organizationName: "Acme" },
    }),
    deps()
  );
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "email is required" });
});

test("POST handler returns the provision payload for the storefront webhook", async () => {
  let received: unknown = null;
  const res = await handleHostedProvisionRequest(
    request({
      headers: { authorization: `Bearer ${SECRET}` },
      body: {
        email: "owner@example.com",
        organizationName: "Acme",
        subscriptionId: "sub_1",
      },
    }),
    deps({
      provision: async (input) => {
        received = input;
        return {
          ok: true,
          organizationId: "org-1",
          userId: "user-1",
          createdUser: true,
          createdOrganization: true,
          loginUrl: "https://app.example.test/login",
          nextStep: "password_reset",
        };
      },
    })
  );

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    ok: true,
    organizationId: "org-1",
    userId: "user-1",
    createdUser: true,
    createdOrganization: true,
    loginUrl: "https://app.example.test/login",
    nextStep: "password_reset",
  });
  assert.deepEqual(received, {
    email: "owner@example.com",
    organizationName: "Acme",
    subscriptionId: "sub_1",
  });
});

test("POST handler hides provision exceptions from the caller", async () => {
  const res = await handleHostedProvisionRequest(
    request({ headers: { authorization: `Bearer ${SECRET}` } }),
    deps({
      provision: async () => {
        throw new Error("DATABASE_URL=postgresql://should-not-leak");
      },
    })
  );
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "provision failed" });
  assert.equal(JSON.stringify(res.body).includes("postgresql://"), false);
});
