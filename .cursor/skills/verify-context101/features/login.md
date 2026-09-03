# Login

Login issues a Better Auth session for an existing email/password user and sends them into the org-gated admin.

## Sub-features

- `login-api` signs in via `POST /api/auth/sign-in/email`.
- `login-session` returns the user from `GET /api/auth/get-session`.
- `login-form` fills Email / Password and clicks Sign in (desktop Chrome with WebGL only).

## How to get to it (user POV)

- Visit `/login`.
- Submit the Sign in form (labels `Email`, `Password`, button `Sign in`).
- Call the Better Auth email sign-in endpoint.

## Driving it with bin/auth-cookie + Chrome DevTools

Preconditions:

- `CONTEXT101_USER` and `CONTEXT101_PASSWORD` are set.
- `http://localhost:3000/login` answers.

- **API sign-in.** Run `bin/auth-cookie`. Exit 0. Stdout is a `name=value` cookie (typically `__Secure-better-auth.session_token=…`).
- **Session.** `curl -sS -H "Cookie: $COOKIE" http://localhost:3000/api/auth/get-session` includes the signed-in user's email.
- **Reach Knowledge.** With the Cookie header emulated, navigate to `/knowledge`. Heading `Knowledge` and tree `Tree View` appear. Do not use `/login` in this agent Chrome.
- **Form path (skip here).** On a GPU browser: fill textbox `Email`, `Password`, click `Sign in`. Unauthenticated `/knowledge` redirects to `/login?next=%2Fknowledge`.

## Gotchas

- Hosted `BETTER_AUTH_URL` rejects browser fetches from `http://localhost:3000` (`INVALID_ORIGIN`). Curl without Origin works.
- The login page uses a WebGL shell. Some agent browsers throw and Next shows "This page couldn't load".
- Cookie is `HttpOnly` + `Secure` + `__Secure-` prefix. Inject it as a request header; `document.cookie` cannot set it.
- Do not print the password or the full cookie in artifacts. Redact to `len` / `has_user`.
