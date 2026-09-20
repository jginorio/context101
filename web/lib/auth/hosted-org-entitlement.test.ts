import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  HOSTED_ORG_SOFT_LOCKED_CODE,
  HOSTED_ORG_SOFT_LOCKED_ERROR,
  hostedOrgAccess,
  hostedRenewUrl,
  hostedOrgSoftLockHttpResponse,
  hostedOrgSoftLockJson,
  isHostedOrgEntitled,
  isOrganizationLockedPath,
  parseOrganizationMetadata,
} from "./hosted-org-entitlement";

const here = path.dirname(fileURLToPath(import.meta.url));
const now = new Date("2026-09-20T20:00:00.000Z");
const futureEnd = "2026-10-20T12:00:00.000Z";
const pastEnd = "2026-09-01T12:00:00.000Z";
const hosted = { APP_MODE: "hosted" };
const selfHost = { APP_MODE: "self_hosted" };

const lockedMeta = {
  source: "creem-storefront",
  creemCustomerId: "cust_1",
  creemSubscriptionId: "sub_1",
  billingStatus: "revoked",
  revokedAt: "2026-09-20T20:00:00.000Z",
  billingReason: "subscription_expired",
};

const graceMeta = {
  source: "creem-storefront",
  creemCustomerId: "cust_1",
  creemSubscriptionId: "sub_1",
  billingStatus: "grace",
  periodEnd: futureEnd,
  billingReason: "subscription_scheduled_cancel",
};

const activeMeta = {
  source: "creem-storefront",
  creemCustomerId: "cust_2",
  creemSubscriptionId: "sub_2",
  billingStatus: "active",
};

test("parses hosted organization.metadata JSON including billing fields", () => {
  const parsed = parseOrganizationMetadata(JSON.stringify(graceMeta));
  assert.deepEqual(parsed, graceMeta);
  assert.equal(parseOrganizationMetadata(null), null);
  assert.equal(parseOrganizationMetadata(""), null);
  assert.equal(parseOrganizationMetadata("{"), null);
  assert.deepEqual(parseOrganizationMetadata(activeMeta), activeMeta);
  assert.equal(
    parseOrganizationMetadata(
      JSON.stringify({ billingStatus: "grace", reason: "subscription_canceled" })
    )?.billingReason,
    "subscription_canceled"
  );
});

test("hosted locked (revoked) is not entitled", () => {
  const access = hostedOrgAccess(lockedMeta, now, hosted);
  assert.equal(access.entitled, false);
  if (access.entitled) throw new Error("expected lock");
  assert.equal(access.code, HOSTED_ORG_SOFT_LOCKED_CODE);
  assert.equal(access.error, HOSTED_ORG_SOFT_LOCKED_ERROR);

  const res = hostedOrgSoftLockJson(access);
  assert.ok(res);
  assert.equal(res.status, 403);
});

test("hosted grace with future periodEnd is entitled", () => {
  assert.equal(isHostedOrgEntitled(graceMeta, now, hosted), true);
  assert.equal(
    isHostedOrgEntitled(JSON.stringify(graceMeta), now, hosted),
    true
  );
  assert.equal(hostedOrgSoftLockJson(hostedOrgAccess(graceMeta, now, hosted)), null);
});

test("hosted grace with past or missing periodEnd is soft-locked", () => {
  assert.equal(
    isHostedOrgEntitled({ billingStatus: "grace", periodEnd: pastEnd }, now, hosted),
    false
  );
  assert.equal(
    isHostedOrgEntitled({ billingStatus: "grace" }, now, hosted),
    false
  );
});

test("hosted revokedAt without billingStatus is soft-locked", () => {
  assert.equal(
    isHostedOrgEntitled(
      { revokedAt: "2026-09-20T20:00:00.000Z" },
      now,
      hosted
    ),
    false
  );
});

test("hosted entitled statuses win over a leftover revokedAt", () => {
  assert.equal(
    isHostedOrgEntitled(
      { billingStatus: "active", revokedAt: "2026-09-01T00:00:00.000Z" },
      now,
      hosted
    ),
    true
  );
  assert.equal(
    isHostedOrgEntitled(
      {
        billingStatus: "grace",
        periodEnd: futureEnd,
        revokedAt: "2026-09-01T00:00:00.000Z",
      },
      now,
      hosted
    ),
    true
  );
});

test("hosted active or unstamped metadata stays entitled", () => {
  assert.equal(isHostedOrgEntitled(activeMeta, now, hosted), true);
  assert.equal(
    isHostedOrgEntitled(
      { source: "creem-storefront", creemCustomerId: "cust_1" },
      now,
      hosted
    ),
    true
  );
  assert.equal(isHostedOrgEntitled(null, now, hosted), true);
  assert.equal(isHostedOrgEntitled({}, now, hosted), true);
});

test("self-host is never gated, even when metadata says revoked", () => {
  for (const env of [
    {},
    selfHost,
    { APP_MODE: "" },
    { APP_MODE: "self_hosted", BILLING_ENABLED: "true" },
  ] as NodeJS.Dict<string>[]) {
    assert.equal(
      isHostedOrgEntitled(lockedMeta, now, env),
      true,
      `self-host must stay open for ${JSON.stringify(env)}`
    );
  }
});

test("multi-org member: locked org gated, active org works", () => {
  const locked = hostedOrgAccess(lockedMeta, now, hosted);
  const other = hostedOrgAccess(activeMeta, now, hosted);
  assert.equal(locked.entitled, false);
  assert.equal(other.entitled, true);

  const lockedRes = hostedOrgSoftLockJson(locked);
  assert.ok(lockedRes);
  assert.equal(lockedRes.status, 403);
  assert.equal(hostedOrgSoftLockJson(other), null);
});

test("Better Auth invite into a locked org is 403; set-active stays open", async () => {
  const invite = await hostedOrgSoftLockHttpResponse(
    {
      method: "POST",
      url: "https://hosted.example.test/api/auth/organization/invite-member",
    },
    {
      isHosted: true,
      now,
      loadActiveOrgMetadata: async () => lockedMeta,
    }
  );
  assert.ok(invite, "invite-member on a locked hosted org must 403");
  assert.equal(invite.status, 403);
  const body = (await invite.json()) as { code?: string; error?: string };
  assert.equal(body.code, HOSTED_ORG_SOFT_LOCKED_CODE);
  assert.equal(body.error, HOSTED_ORG_SOFT_LOCKED_ERROR);

  const graceInvite = await hostedOrgSoftLockHttpResponse(
    {
      method: "POST",
      url: "https://hosted.example.test/api/auth/organization/invite-member",
    },
    {
      isHosted: true,
      now,
      loadActiveOrgMetadata: async () => graceMeta,
    }
  );
  assert.equal(graceInvite, null, "grace with future periodEnd may invite");

  const setActive = await hostedOrgSoftLockHttpResponse(
    {
      method: "POST",
      url: "https://hosted.example.test/api/auth/organization/set-active",
    },
    {
      isHosted: true,
      now,
      loadActiveOrgMetadata: async () => lockedMeta,
    }
  );
  assert.equal(setActive, null, "set-active must stay allowed so users can switch orgs");

  const selfHostInvite = await hostedOrgSoftLockHttpResponse(
    {
      method: "POST",
      url: "http://localhost:3000/api/auth/organization/invite-member",
    },
    {
      isHosted: false,
      now,
      loadActiveOrgMetadata: async () => lockedMeta,
    }
  );
  assert.equal(selfHostInvite, null, "self-host HTTP invite must pass through");
});

test("only org product-mutation paths are treated as locked-org gates", () => {
  assert.equal(
    isOrganizationLockedPath("/api/auth/organization/invite-member"),
    true
  );
  assert.equal(
    isOrganizationLockedPath("/api/auth/organization/cancel-invitation"),
    true
  );
  assert.equal(
    isOrganizationLockedPath("/api/auth/organization/remove-member"),
    true
  );
  assert.equal(
    isOrganizationLockedPath("/api/auth/organization/update-member-role"),
    true
  );
  assert.equal(isOrganizationLockedPath("/api/auth/organization/update"), true);
  assert.equal(
    isOrganizationLockedPath("/api/auth/organization/set-active"),
    false
  );
  assert.equal(
    isOrganizationLockedPath("/api/auth/organization/accept-invitation"),
    false
  );
  assert.equal(isOrganizationLockedPath("/api/auth/sign-in/email"), false);
  assert.equal(
    isOrganizationLockedPath("/api/auth/organization/create"),
    false
  );
});

test("runtime wires the soft-lock to APP_MODE hosted detection only", () => {
  const server = readFileSync(path.join(here, "server.ts"), "utf8");
  assert.equal(server.includes("HOSTED_ORG_SOFT_LOCKED"), false);

  const brains = readFileSync(path.join(here, "../brains-server.ts"), "utf8");
  assert.match(brains, /hostedOrgAccess/);
  assert.match(brains, /HOSTED_ORG_SOFT_LOCKED_CODE/);
  assert.match(brains, /readAuthContext/);

  const requireOrg = readFileSync(path.join(here, "require-org.ts"), "utf8");
  assert.match(requireOrg, /hostedOrgAccess/);
  assert.match(requireOrg, /\/renew/);

  const route = readFileSync(
    path.join(here, "../../app/api/auth/[...all]/route.ts"),
    "utf8"
  );
  assert.match(route, /hostedOrgSoftLockHttpResponse/);
  assert.match(route, /deploymentConfig\.isHosted/);

  const renewPage = readFileSync(
    path.join(here, "../../app/renew/page.tsx"),
    "utf8"
  );
  assert.match(renewPage, /hostedRenewUrl/);
  assert.match(renewPage, /hostedOrgAccess/);
  assert.match(renewPage, /RenewScreen/);

  const renewScreen = readFileSync(
    path.join(here, "../../components/renew-screen.tsx"),
    "utf8"
  );
  assert.match(renewScreen, /Subscription ended/);
  assert.match(renewScreen, /Renew/);
  assert.match(renewScreen, /Switch organization/);
  assert.equal(renewScreen.toLowerCase().includes("creem"), false);
  assert.equal(renewScreen.toLowerCase().includes("stripe"), false);

  const renewUrl = hostedRenewUrl({});
  assert.match(renewUrl, /^https:\/\//);
  assert.equal(renewUrl.includes("creem"), false);
  assert.equal(
    hostedRenewUrl({ HOSTED_RENEW_URL: "https://billing.example.test" }),
    "https://billing.example.test"
  );
});
