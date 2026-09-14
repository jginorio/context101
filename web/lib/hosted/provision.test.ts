import assert from "node:assert/strict";
import { test } from "node:test";

import {
  hostedOrganizationSlug,
  nameFromEmail,
  parseHostedProvisionBody,
  provisionHostedOrganization,
  slugify,
  type HostedMembership,
  type HostedOrganization,
  type HostedProvisionStore,
  type HostedUser,
} from "./provision";

function memoryStore(seed?: {
  users?: HostedUser[];
  orgs?: HostedOrganization[];
  members?: Array<HostedMembership & { userId: string; organizationId: string }>;
  signUpFails?: boolean;
  hideUsersUntilSignUp?: boolean;
  createOrgFails?: boolean;
}) {
  const users = [...(seed?.users ?? [])];
  const orgs = [...(seed?.orgs ?? [])];
  const members = [...(seed?.members ?? [])];
  let revealUsers = !seed?.hideUsersUntilSignUp;
  const calls = {
    signUpEmail: 0,
    createOrganization: 0,
    addMember: 0,
    setMemberRole: 0,
    requestPasswordReset: [] as string[],
    createdMetadata: [] as Record<string, string>[],
  };

  const store: HostedProvisionStore = {
    async findUserByEmail(email) {
      if (!revealUsers) return null;
      return users.find((row) => row.email === email) ?? null;
    },
    async findOrganizationBySlug(slug) {
      return orgs.find((row) => row.slug === slug) ?? null;
    },
    async findMembership(userId, organizationId) {
      return (
        members.find(
          (row) => row.userId === userId && row.organizationId === organizationId
        ) ?? null
      );
    },
    async setMemberRole(memberId, role) {
      calls.setMemberRole += 1;
      const row = members.find((item) => item.id === memberId);
      if (row) row.role = role;
    },
    async signUpEmail({ name, email }) {
      calls.signUpEmail += 1;
      if (seed?.signUpFails) {
        revealUsers = true;
        throw new Error("USER_ALREADY_EXISTS");
      }
      const created = { id: `user-${users.length + 1}`, email, name };
      users.push(created);
      return { id: created.id };
    },
    async createOrganization({ name, slug, userId, metadata }) {
      calls.createOrganization += 1;
      calls.createdMetadata.push(metadata);
      if (seed?.createOrgFails) throw new Error("ORGANIZATION_ALREADY_EXISTS");
      const created = { id: `org-${orgs.length + 1}`, name, slug, metadata: null };
      orgs.push(created);
      members.push({
        id: `mem-${members.length + 1}`,
        userId,
        organizationId: created.id,
        role: "admin",
      });
      return created;
    },
    async addMember({ userId, organizationId, role }) {
      calls.addMember += 1;
      members.push({
        id: `mem-${members.length + 1}`,
        userId,
        organizationId,
        role,
      });
    },
    async requestPasswordReset(email) {
      calls.requestPasswordReset.push(email);
    },
  };

  return { store, users, orgs, members, calls };
}

test("slugify and nameFromEmail match setup-style identifiers", () => {
  assert.equal(slugify("Acme Labs"), "acme-labs");
  assert.equal(nameFromEmail("jaime.ginorio@example.com"), "Jaime Ginorio");
  assert.equal(nameFromEmail("solo@example.com"), "Solo");
});

test("hosted slugs are stable for the same billing key and opaque", () => {
  const first = hostedOrganizationSlug({ subscriptionId: "sub_123" });
  const second = hostedOrganizationSlug({ subscriptionId: "sub_123" });
  const other = hostedOrganizationSlug({ subscriptionId: "sub_999" });
  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first ?? "", /^hosted-[0-9a-f]{20}$/);
  assert.equal((first ?? "").includes("sub_123"), false);
});

test("parseHostedProvisionBody requires a valid email and string optionals", () => {
  assert.deepEqual(parseHostedProvisionBody(null), {
    ok: false,
    error: "email is required",
  });
  assert.deepEqual(parseHostedProvisionBody({ email: "not-an-email" }), {
    ok: false,
    error: "email is invalid",
  });
  assert.deepEqual(parseHostedProvisionBody({ email: "a@b.com", organizationName: 1 }), {
    ok: false,
    error: "organizationName must be a string",
  });
  assert.deepEqual(parseHostedProvisionBody({
    email: " Jaime@Example.COM ",
    organizationName: " Acme ",
    subscriptionId: "sub_1",
  }), {
    ok: true,
    value: {
      email: "jaime@example.com",
      organizationName: "Acme",
      subscriptionId: "sub_1",
    },
  });
});

test("creates a user and organization, then sends the existing password reset", async () => {
  const { store, calls } = memoryStore();
  const result = await provisionHostedOrganization(
    {
      email: "owner@example.com",
      organizationName: "Acme",
      subscriptionId: "sub_1",
    },
    store,
    { appUrl: "https://app.example.test", randomPassword: () => "unused-password" }
  );

  assert.equal(result.ok, true);
  assert.equal(result.createdUser, true);
  assert.equal(result.createdOrganization, true);
  assert.equal(result.nextStep, "password_reset");
  assert.equal(result.loginUrl, "https://app.example.test/login");
  assert.equal(calls.signUpEmail, 1);
  assert.equal(calls.createOrganization, 1);
  assert.deepEqual(calls.requestPasswordReset, ["owner@example.com"]);
  assert.deepEqual(calls.createdMetadata[0], {
    hostedProvision: "true",
    subscriptionId: "sub_1",
  });
});

test("reuses an existing user and does not send another reset", async () => {
  const { store, calls } = memoryStore({
    users: [{ id: "user-1", email: "owner@example.com", name: "Owner" }],
  });
  const result = await provisionHostedOrganization(
    { email: "owner@example.com", organizationName: "Acme" },
    store,
    {
      appUrl: "https://app.example.test",
      randomSuffix: () => "abc123",
    }
  );

  assert.equal(result.userId, "user-1");
  assert.equal(result.createdUser, false);
  assert.equal(result.nextStep, "sign_in");
  assert.equal(calls.signUpEmail, 0);
  assert.deepEqual(calls.requestPasswordReset, []);
  assert.equal(result.createdOrganization, true);
});

test("is idempotent when the subscription org already exists", async () => {
  const slug = hostedOrganizationSlug({ subscriptionId: "sub_1" });
  assert.ok(slug);
  const { store, calls } = memoryStore({
    users: [{ id: "user-1", email: "owner@example.com", name: "Owner" }],
    orgs: [{ id: "org-1", name: "Acme", slug, metadata: null }],
    members: [
      { id: "mem-1", userId: "user-1", organizationId: "org-1", role: "admin" },
    ],
  });

  const result = await provisionHostedOrganization(
    { email: "owner@example.com", subscriptionId: "sub_1" },
    store,
    { appUrl: "https://app.example.test" }
  );

  assert.equal(result.organizationId, "org-1");
  assert.equal(result.userId, "user-1");
  assert.equal(result.createdOrganization, false);
  assert.equal(calls.createOrganization, 0);
  assert.equal(calls.addMember, 0);
  assert.equal(calls.setMemberRole, 0);
});

test("attaches an existing user as admin on a subscription org", async () => {
  const slug = hostedOrganizationSlug({ subscriptionId: "sub_1" });
  assert.ok(slug);
  const { store, calls } = memoryStore({
    users: [{ id: "user-2", email: "plus@example.com", name: "Plus" }],
    orgs: [{ id: "org-1", name: "Acme", slug, metadata: null }],
  });

  const result = await provisionHostedOrganization(
    { email: "plus@example.com", subscriptionId: "sub_1" },
    store,
    { appUrl: "https://app.example.test" }
  );

  assert.equal(result.organizationId, "org-1");
  assert.equal(result.createdOrganization, false);
  assert.equal(calls.addMember, 1);
});

test("promotes a non-admin member on retry", async () => {
  const slug = hostedOrganizationSlug({ idempotencyKey: "pay_1" });
  assert.ok(slug);
  const { store, calls, members } = memoryStore({
    users: [{ id: "user-1", email: "owner@example.com", name: "Owner" }],
    orgs: [{ id: "org-1", name: "Acme", slug, metadata: null }],
    members: [
      { id: "mem-1", userId: "user-1", organizationId: "org-1", role: "member" },
    ],
  });

  await provisionHostedOrganization(
    { email: "owner@example.com", idempotencyKey: "pay_1" },
    store,
    { appUrl: "https://app.example.test" }
  );

  assert.equal(calls.setMemberRole, 1);
  assert.equal(members[0]?.role, "admin");
});

test("recovers from a signup race by loading the existing user", async () => {
  const { store, calls } = memoryStore({
    users: [{ id: "user-1", email: "owner@example.com", name: "Owner" }],
    signUpFails: true,
    hideUsersUntilSignUp: true,
  });

  const result = await provisionHostedOrganization(
    { email: "owner@example.com", organizationName: "Acme" },
    store,
    { appUrl: "https://app.example.test", randomSuffix: () => "xyz789" }
  );

  assert.equal(result.userId, "user-1");
  assert.equal(result.createdUser, false);
  assert.equal(calls.signUpEmail, 1);
  assert.deepEqual(calls.requestPasswordReset, []);
});
