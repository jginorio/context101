import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource";

/**
 * Amplify Gen 2 backend for Context101.
 *
 * Currently provisions:
 *   - Cognito user pool (via defineAuth)
 *
 * S3 access happens in Next.js API routes using the SSR compute role
 * (in prod) or the developer's AWS profile (in local dev). The docs
 * bucket itself is provisioned by the sibling CDK stack — this backend
 * doesn't touch it.
 */
defineBackend({
  auth,
});
