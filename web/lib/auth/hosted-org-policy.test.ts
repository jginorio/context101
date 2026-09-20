import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  HOSTED_ORG_CREATE_CODE,
  HOSTED_ORG_CREATE_ERROR,
  allowUserToCreateOrganization,
  hostedOrgCreateHttpResponse,
  isHostedOrgActionAllowed,
  isOrganizationCreatePath,
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

test("Hosted blocks user org create; self-host allows it", () => {
  assert.equal(allowUserToCreateOrganization(true), false);
  assert.equal(allowUserToCreateOrganization(false), true);
  assert.equal(isHostedOrgActionAllowed("create", true), false);
  assert.equal(isHostedOrgActionAllowed("create", false), true);
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

test("HTTP gate rejects Hosted organization/create with the checkout error", async () => {
  const blocked = hostedOrgCreateHttpResponse(
    {
      method: "POST",
      url: "https://hosted.example.test/api/auth/organization/create",
    },
    true
  );
  assert.ok(blocked);
  assert.equal(blocked.status, 403);
  const body = (await blocked.json()) as {
    message?: string;
    code?: string;
  };
  assert.equal(body.message, HOSTED_ORG_CREATE_ERROR);
  assert.equal(body.code, HOSTED_ORG_CREATE_CODE);
  assert.match(HOSTED_ORG_CREATE_ERROR, /checkout/i);
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

test("HTTP gate is a no-op on self-host, including create", () => {
  assert.equal(
    hostedOrgCreateHttpResponse(
      {
        method: "POST",
        url: "http://localhost:3000/api/auth/organization/create",
      },
      false
    ),
    null
  );
});

test("chooser copy hides create on Hosted and keeps it on self-host", () => {
  const hostedEmpty = orgsChooserCopy({ isHosted: true, orgCount: 0 });
  assert.equal(hostedEmpty.allowCreate, false);
  assert.match(hostedEmpty.description, /invited/i);
  assert.equal(hostedEmpty.description.includes("Create your first"), false);

  const hostedWithOrgs = orgsChooserCopy({ isHosted: true, orgCount: 2 });
  assert.equal(hostedWithOrgs.allowCreate, false);
  assert.match(hostedWithOrgs.description, /Pick the workspace/);

  const selfHostEmpty = orgsChooserCopy({ isHosted: false, orgCount: 0 });
  assert.equal(selfHostEmpty.allowCreate, true);
  assert.match(selfHostEmpty.description, /Create your first organization/);
});

test("Better Auth runtime wires the Hosted create gate", () => {
  const server = readFileSync(path.join(here, "server.ts"), "utf8");
  assert.match(server, /allowUserToCreateOrganization/);
  assert.match(server, /hosted-org-policy/);
  assert.match(server, /deploymentConfig\.isHosted/);

  const route = readFileSync(
    path.join(here, "../../app/api/auth/[...all]/route.ts"),
    "utf8"
  );
  assert.match(route, /hostedOrgCreateHttpResponse/);
  assert.match(route, /deploymentConfig\.isHosted/);

  const chooser = readFileSync(
    path.join(here, "../../components/org-chooser.tsx"),
    "utf8"
  );
  assert.match(chooser, /allowCreate/);
  assert.match(chooser, /New organization/);

  const orgsPage = readFileSync(
    path.join(here, "../../app/orgs/page.tsx"),
    "utf8"
  );
  assert.match(orgsPage, /orgsChooserCopy/);
  assert.match(orgsPage, /allowCreate/);
});
