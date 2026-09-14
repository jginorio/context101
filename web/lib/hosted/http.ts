import { and, eq } from "drizzle-orm";

import { getSetupAuth } from "@/lib/auth/server";
import { deploymentConfig } from "@/lib/deployment/config";
import { db } from "@/lib/db/client";
import { member, organization, user } from "@/lib/db/auth-schema";

import {
  parseHostedProvisionBody,
  provisionHostedOrganization,
  type HostedProvisionResult,
  type HostedProvisionStore,
} from "./provision";
import {
  HOSTED_PROVISION_SECRET_ENV,
  hostedProvisionGate,
  presentedHostedProvisionSecret,
} from "./secret";

export type HostedProvisionHttpResult = {
  status: number;
  body: Record<string, unknown>;
};

export type HostedProvisionHttpDeps = {
  isHosted: boolean;
  expectedSecret: string | undefined;
  hasDatabase: boolean;
  appUrl: string;
  provision: (
    input: Parameters<typeof provisionHostedOrganization>[0]
  ) => Promise<HostedProvisionResult>;
};

export function createLiveHostedProvisionStore(): HostedProvisionStore {
  if (!db) throw new Error("DATABASE_URL is not configured");
  const database = db;

  return {
    async findUserByEmail(email) {
      const [row] = await database
        .select({ id: user.id, email: user.email, name: user.name })
        .from(user)
        .where(eq(user.email, email))
        .limit(1);
      return row ?? null;
    },
    async findOrganizationBySlug(slug) {
      const [row] = await database
        .select({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          metadata: organization.metadata,
        })
        .from(organization)
        .where(eq(organization.slug, slug))
        .limit(1);
      return row ?? null;
    },
    async findMembership(userId, organizationId) {
      const [row] = await database
        .select({ id: member.id, role: member.role })
        .from(member)
        .where(
          and(eq(member.userId, userId), eq(member.organizationId, organizationId))
        )
        .limit(1);
      return row ?? null;
    },
    async setMemberRole(memberId, role) {
      await database.update(member).set({ role }).where(eq(member.id, memberId));
    },
    async signUpEmail({ name, email, password }) {
      const signup = (await getSetupAuth().api.signUpEmail({
        body: { name, email, password },
      })) as { user?: { id?: string } };
      const id = signup.user?.id;
      if (!id) throw new Error("failed to create owner user");
      return { id };
    },
    async createOrganization({ name, slug, userId, metadata }) {
      const org = (await getSetupAuth().api.createOrganization({
        body: {
          name,
          slug,
          userId,
          metadata,
          keepCurrentActiveOrganization: true,
        },
      })) as { id?: string; name?: string; slug?: string };
      if (!org?.id) throw new Error("failed to create organization");
      return { id: org.id, name: org.name ?? name, slug: org.slug ?? slug };
    },
    async addMember({ userId, organizationId, role }) {
      await getSetupAuth().api.addMember({
        body: { userId, organizationId, role },
      });
    },
    async requestPasswordReset(email) {
      await getSetupAuth().api.requestPasswordReset({
        body: { email },
      });
    },
  };
}

export function liveHostedProvisionDeps(): HostedProvisionHttpDeps {
  return {
    isHosted: deploymentConfig.isHosted,
    expectedSecret: process.env[HOSTED_PROVISION_SECRET_ENV],
    hasDatabase: !!db,
    appUrl: deploymentConfig.appUrl,
    provision: (input) =>
      provisionHostedOrganization(input, createLiveHostedProvisionStore(), {
        appUrl: deploymentConfig.appUrl,
      }),
  };
}

export async function handleHostedProvisionRequest(
  request: Request,
  deps: HostedProvisionHttpDeps
): Promise<HostedProvisionHttpResult> {
  const gate = hostedProvisionGate({
    isHosted: deps.isHosted,
    expectedSecret: deps.expectedSecret,
    presentedSecret: presentedHostedProvisionSecret(request.headers),
    hasDatabase: deps.hasDatabase,
  });
  if (!gate.ok) {
    return { status: gate.status, body: { error: gate.error } };
  }

  const parsed = parseHostedProvisionBody(await request.json().catch(() => null));
  if (!parsed.ok) {
    return { status: 400, body: { error: parsed.error } };
  }

  try {
    const result = await deps.provision(parsed.value);
    console.info("[hosted-provision]", {
      organizationId: result.organizationId,
      userId: result.userId,
      createdUser: result.createdUser,
      createdOrganization: result.createdOrganization,
      nextStep: result.nextStep,
    });
    return { status: 200, body: result };
  } catch (err) {
    console.error("[hosted-provision] failed");
    return { status: 500, body: { error: "provision failed" } };
  }
}
