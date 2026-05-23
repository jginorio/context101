# Security Policy

## Supported Versions

Context101 is currently alpha software. Security fixes are handled on the main branch until there are tagged releases.

## Reporting A Vulnerability

Please do not open a public issue for a suspected vulnerability.

Email the maintainer or use GitHub private vulnerability reporting once it is enabled for the repository. Include:

- A short description of the issue.
- Reproduction steps or proof-of-concept details.
- Impact and affected deployment surface, if known.
- Whether the issue affects self-hosted deployments, the public site, or both.

## Current Security Model

Context101 is intended for trusted internal teams.

- The web app is gated by Cognito, but every signed-in user currently has broad admin capabilities.
- MCP access uses per-brain bearer tokens stored in AWS Secrets Manager.
- Any signed-in web user can reveal ready brain bearer tokens.
- Data-source connector credentials are stored in Secrets Manager, but connector flows are still alpha.
- The project is not ready for public multi-tenant hosting.

See `ALPHA.md` for the current caveats and non-goals.
