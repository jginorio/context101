import { createServerRunner } from "@aws-amplify/adapter-nextjs";
import { fetchAuthSession } from "aws-amplify/auth/server";
import type { NextRequest, NextResponse } from "next/server";
import outputs from "@/amplify_outputs.json";

export const { runWithAmplifyServerContext } = createServerRunner({
  config: outputs,
});

/**
 * Returns the signed-in user's email (from the Cognito ID token's
 * `email` claim), or null if the token is missing / unreadable.
 *
 * Used for audit fields like `created_by` on connectors/suggestions.
 */
export async function getCurrentUserEmail(
  request: NextRequest,
  response: NextResponse
): Promise<string | null> {
  try {
    return await runWithAmplifyServerContext({
      nextServerContext: { request, response },
      operation: async (ctx) => {
        const session = await fetchAuthSession(ctx);
        const claims = session.tokens?.idToken?.payload;
        const email = claims?.email;
        return typeof email === "string" ? email : null;
      },
    });
  } catch {
    return null;
  }
}
