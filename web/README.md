# Context101 Web App

This is the deployable Context101 admin. It ships inside `context101-cli` on Amplify.

Self-hosted users deploy this app. The root route redirects into `/knowledge`; the app is gated by Better Auth once deployed.

## Local Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Most routes need the AWS environment variables that CDK/Amplify inject in deployed environments.

## Checks

```bash
npm run build
npm run lint
npm test
```

`npm test` runs the `node:test` files under `lib/` and `utils/` (`tsx --test`).

## Magic link

Hosted checkout (and the login form) can send a one-click sign-in email through Better Auth's magic-link plugin. Password sign-in stays enabled.

### Storefront / API

`POST /api/auth/sign-in/magic-link`

```json
{ "email": "user@example.com", "callbackURL": "/knowledge" }
```

`callbackURL` is optional (defaults to `/`). `Content-Type: application/json`.

A well-formed request returns `{ "status": true }` whether or not the account exists (no email enumeration). Clicking the emailed link hits `APP_URL/api/auth/magic-link/verify` and sets a session cookie. If the user has an organization membership, the existing session hook still sets `activeOrganizationId`.

When `ALLOW_PUBLIC_SIGNUP=false` (Hosted production):

- Existing users — including passwordless accounts with `email_verified=true` — receive the email.
- Unknown emails get the same success response and no email.

When `ALLOW_PUBLIC_SIGNUP=true`, unknown emails also receive a link and Better Auth will create the user on verify.

### Hosted organizations

When `APP_MODE=hosted`, Better Auth `organization/create` is disabled. New orgs are created at Creem checkout (private hosted provision), not from the admin UI. Invites and accept-invitation still work. Self-host (`APP_MODE=self_hosted`, the default) can still create organizations.

Call this from a **server** (no `Origin` header), the same way password sign-in works from curl. A browser `Origin` must match `BETTER_AUTH_URL` / `APP_URL`. Optional Better Auth env (names only): `BETTER_AUTH_TRUSTED_ORIGINS` (comma-separated origins). No new secrets; magic link reuses `SES_FROM_EMAIL`, `SES_REGION`, `APP_URL`, `BETTER_AUTH_URL`, and `BETTER_AUTH_SECRET`.

The login page also has **Email me a sign-in link**.

## Deployment

## Deployment

`amplify.yml` points Amplify Hosting at this `web` app. The CDK stack injects the environment needed for the admin UI, API routes, connectors, wiki generation, and brain control plane.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
