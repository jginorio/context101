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

export type Auth = ReturnType<typeof getAuth>;
