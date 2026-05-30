import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { eq } from "drizzle-orm";

import { deploymentConfig } from "@/lib/deployment/config";
import { db } from "@/lib/db/client";
import * as authSchema from "@/lib/db/auth-schema";

type AuthRuntime = {
  handler: (request: Request) => Promise<Response>;
  api: Record<string, (...args: unknown[]) => Promise<unknown>>;
};

let authInstance: AuthRuntime | undefined;
let setupAuthInstance: AuthRuntime | undefined;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function createAuthRuntime({ disableSignUp }: { disableSignUp: boolean }) {
  if (!db) throw new Error("DATABASE_URL is not configured");
  const database = db;

  const options = {
    secret: requiredEnv("BETTER_AUTH_SECRET"),
    baseURL: requiredEnv("BETTER_AUTH_URL"),
    database: drizzleAdapter(database, {
      provider: "pg",
      schema: authSchema,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp,
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session: { userId: string }) => {
            const [membership] = await database
              .select({ organizationId: authSchema.member.organizationId })
              .from(authSchema.member)
              .where(eq(authSchema.member.userId, session.userId))
              .limit(1);

            if (!membership) return;

            return {
              data: {
                ...session,
                activeOrganizationId: membership.organizationId,
              },
            };
          },
        },
      },
    },
    plugins: [
      organization({
        creatorRole: "admin",
        // We surface invite links manually (no email infra) and have no email
        // verification flow, so don't block invitation accept on a verified
        // email — this plugin option defaults to `true`.
        requireEmailVerificationOnInvitation: false,
        // No transactional email infra yet. We still implement this so
        // inviteMember succeeds and the accept link is captured in logs;
        // the Settings UI surfaces a copyable link per pending invitation
        // (built from listInvitations), so admins can share it manually.
        sendInvitationEmail: async (data: {
          id: string;
          email: string;
          role: string;
          organization: { name?: string };
        }) => {
          const base = deploymentConfig.appUrl.replace(/\/$/, "");
          const link = `${base}/accept-invitation/${data.id}`;
          console.log(
            `[org] invitation for ${data.email} (role=${data.role}) to "${data.organization?.name ?? "org"}": ${link}`
          );
        },
      }),
      // Keep this last so Better Auth can apply Set-Cookie headers from
      // server actions / route handlers in Next.js.
      nextCookies(),
    ],
  };

  return betterAuth(options) as unknown as AuthRuntime;
}

export function getAuth(): AuthRuntime {
  if (authInstance) return authInstance;
  authInstance = createAuthRuntime({
    disableSignUp: !deploymentConfig.allowPublicSignup,
  });
  return authInstance;
}

export function getSetupAuth(): AuthRuntime {
  if (setupAuthInstance) return setupAuthInstance;
  setupAuthInstance = createAuthRuntime({ disableSignUp: false });
  return setupAuthInstance;
}

/**
 * Hash a password with the same hasher Better Auth uses for sign-in, so a
 * value written directly to the `account` table verifies correctly. Used by
 * the admin "reset member password" flow (Better Auth has no built-in API to
 * set another user's password without the admin plugin).
 */
export async function hashPassword(password: string): Promise<string> {
  const instance = getAuth() as unknown as {
    $context: Promise<{ password: { hash: (p: string) => Promise<string> } }>;
  };
  const ctx = await instance.$context;
  return ctx.password.hash(password);
}

export type Auth = ReturnType<typeof getAuth>;
