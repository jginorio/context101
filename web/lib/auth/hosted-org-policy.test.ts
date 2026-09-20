import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  HOSTED_ORG_CREATE_CODE,
  HOSTED_ORG_CREATE_ERROR,
  hostedOrgCreateHttpResponse,
  isHostedOrgActionAllowed,
  isOrganizationCreatePath,
  organizationCreatePolicy,
  orgsChooserCopy,
  type OrgUserAction,
} from "./hosted-org-policy";

const here = path.dirname(fileURLToPath(import.meta.url));

const JOIN_ACTIONS: OrgUserAction[] = [
  "inviteMember",
  "acceptInvitation",
  "rejectInvitation",
  "cancelInvitation",
  "setActive",
  "listMembers",
  "listInvitations",
  "updateMemberRole",
  "removeMember",
  "updateOrganization",
  "getFullOrganization",
];

const CREATE_URL = "https://hosted.example.test/api/auth/organization/create";
const SELF_HOST_CREATE_URL =
  "http://localhost:3000/api/auth/organization/create";

async function createGateResponse(isHosted: boolean, url = CREATE_URL) {
  return hostedOrgCreateHttpResponse({ method: "POST", url }, isHosted);
}

test("Hosted (APP_MODE=hosted) blocks organization.create", async () => {
  const policy = organizationCreatePolicy({ APP_MODE: "hosted" });
  assert.equal(policy.isHosted, true);
  assert.equal(policy.allowUserToCreateOrganization, false);
  assert.equal(isHostedOrgActionAllowed("create", true), false);

  const blocked = await createGateResponse(true);
  assert.ok(blocked, "Hosted HTTP organization/create must be rejected");
  assert.equal(blocked.status, 403);
  const body = (await blocked.json()) as { message?: string; code?: string };
  assert.equal(body.message, HOSTED_ORG_CREATE_ERROR);
  assert.equal(body.code, HOSTED_ORG_CREATE_CODE);
  assert.match(HOSTED_ORG_CREATE_ERROR, /checkout/i);

  const copy = orgsChooserCopy({ isHosted: true, orgCount: 0 });
  assert.equal(copy.allowCreate, false);
  assert.match(copy.description, /invited/i);
});

test("self-host keeps full organization.create", async () => {
  for (const env of [
    {},
    { APP_MODE: "self_hosted" },
    { APP_MODE: "" },
    {
      APP_MODE: "self_hosted",
      BILLING_ENABLED: "true",
      ALLOW_PUBLIC_SIGNUP: "true",
    },
  ] as NodeJS.Dict<string>[]) {
    const policy = organizationCreatePolicy(env);
    assert.equal(
      policy.isHosted,
      false,
      `expected not hosted for ${JSON.stringify(env)}`
    );
    assert.equal(
      policy.allowUserToCreateOrganization,
      true,
      `self-host must allow create for ${JSON.stringify(env)}`
    );
  }

  assert.equal(isHostedOrgActionAllowed("create", false), true);

  assert.equal(
    await createGateResponse(false, SELF_HOST_CREATE_URL),
    null,
    "self-host HTTP organization/create must pass through"
  );
  assert.equal(
    await createGateResponse(false, CREATE_URL),
    null,
    "the HTTP gate keys off isHosted, not the request host"
  );

  const empty = orgsChooserCopy({ isHosted: false, orgCount: 0 });
  assert.equal(empty.allowCreate, true);
  assert.match(empty.description, /Create your first organization/);

  const withOrgs = orgsChooserCopy({ isHosted: false, orgCount: 2 });
  assert.equal(withOrgs.allowCreate, true);
});

test("Hosted still allows invite, accept, and other org membership APIs", () => {
  for (const action of JOIN_ACTIONS) {
    assert.equal(
      isHostedOrgActionAllowed(action, true),
      true,
      `expected ${action} to stay allowed on Hosted`
    );
    assert.equal(isHostedOrgActionAllowed(action, false), true);
  }
});

test("only the create organization path is treated as create", () => {
  assert.equal(isOrganizationCreatePath("/api/auth/organization/create"), true);
  assert.equal(isOrganizationCreatePath("/organization/create"), true);
  assert.equal(isOrganizationCreatePath("/api/auth/organization/create/"), true);
  assert.equal(
    isOrganizationCreatePath("/api/auth/organization/create-team"),
    false
  );
  assert.equal(
    isOrganizationCreatePath("/api/auth/organization/create-role"),
    false
  );
  assert.equal(
    isOrganizationCreatePath("/api/auth/organization/invite-member"),
    false
  );
  assert.equal(
    isOrganizationCreatePath("/api/auth/organization/accept-invitation"),
    false
  );
  assert.equal(isOrganizationCreatePath("/api/auth/sign-in/email"), false);
});

test("HTTP gate does not intercept invite or accept on Hosted", () => {
  for (const url of [
    "https://hosted.example.test/api/auth/organization/invite-member",
    "https://hosted.example.test/api/auth/organization/accept-invitation",
    "https://hosted.example.test/api/auth/organization/set-active",
  ]) {
    assert.equal(
      hostedOrgCreateHttpResponse({ method: "POST", url }, true),
      null,
      `expected ${url} to pass through`
    );
  }
});

test("runtime wires the gate to APP_MODE hosted detection only", () => {
  const server = readFileSync(path.join(here, "server.ts"), "utf8");
  assert.match(server, /allowUserToCreateOrganization/);
  assert.match(server, /hosted-org-policy/);
  assert.match(
    server,
    /allowUserToCreateOrganization\(\s*deploymentConfig\.isHosted/
  );
  assert.equal(server.includes("billingEnabled"), false);

  const route = readFileSync(
    path.join(here, "../../app/api/auth/[...all]/route.ts"),
    "utf8"
  );
  assert.match(route, /hostedOrgCreateHttpResponse/);
  assert.match(route, /deploymentConfig\.isHosted/);
  assert.equal(route.includes("billingEnabled"), false);

  const chooser = readFileSync(
    path.join(here, "../../components/org-chooser.tsx"),
    "utf8"
  );
  assert.match(chooser, /allowCreate/);
  assert.match(chooser, /allowCreate = true/);
  assert.match(chooser, /New organization/);

  const orgsPage = readFileSync(
    path.join(here, "../../app/orgs/page.tsx"),
    "utf8"
  );
  assert.match(orgsPage, /orgsChooserCopy/);
  assert.match(orgsPage, /deploymentConfig\.isHosted/);
  assert.match(orgsPage, /allowCreate/);

  const setup = readFileSync(
    path.join(here, "../../app/api/setup/owner/route.ts"),
    "utf8"
  );
  assert.match(setup, /createOrganization/);
  assert.match(setup, /isSelfHosted/);
});
