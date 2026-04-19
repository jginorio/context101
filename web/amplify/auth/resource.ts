import { defineAuth } from "@aws-amplify/backend";

/**
 * Cognito user pool for Context101 admins.
 *
 * Users are invited by an admin (no self-signup). They receive an
 * email with a temporary password; on first login they must set
 * a new one.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  userAttributes: {
    email: { required: true, mutable: true },
    preferredUsername: { required: false, mutable: true },
  },
  // No triggers yet. Add a pre-signup Lambda if you want to
  // restrict by email domain (e.g. only @redventures.com).
});
