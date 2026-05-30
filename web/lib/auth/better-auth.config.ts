import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

import { db } from "@/lib/db/client";
import * as authSchema from "@/lib/db/auth-schema";

if (!db) {
  throw new Error("DATABASE_URL is required to load Better Auth config");
}

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET ?? "development-only-better-auth-secret-change-me",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    organization({
      creatorRole: "admin",
    }),
  ],
});
