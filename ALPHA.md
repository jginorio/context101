# Context101 Alpha Status

Context101 is alpha software. It started as an internal proof of concept and is being opened so other teams can self-host, evaluate, and evolve it for their own trusted internal use.

## Intended Use

- Trusted internal teams running the stack in their own AWS account.
- Small to medium knowledge bases where the operating team is comfortable with AWS, CDK, Bedrock, and MCP clients.
- Experimentation with shared agent context, human-reviewed suggestions, generated wikis, and early data-source connectors.

## Not Yet Intended For

- Public multi-tenant hosting.
- Untrusted users or hostile tenants.
- Per-customer billing, tenant isolation, or compliance-sensitive production workloads.
- Fully automated ingestion of sensitive third-party systems without operator review.

## Known Product Caveats

- Any signed-in user in the organization is currently an admin for the web app.
- Any signed-in user can reveal a ready brain's MCP bearer token.
- There is no per-brain RBAC, per-document ACL, SCIM, SSO, or per-user MCP audit trail yet.
- The GitHub connector uses a pasted Personal Access Token rather than a GitHub App/OAuth install flow.
- Google Workspace, Notion, and GitHub connectors are useful but still early and intentionally simple.
- Wiki generation uses Claude through Bedrock and can become expensive as corpus size grows.
- Runtime-created brains are outside CloudFormation lifecycle; delete them in the app before destroying the stack.

## AWS Caveats

- The smooth path is `us-east-1`.
- You need Bedrock model access for Titan embeddings and the Claude model used by improve/wiki flows.
- You need Docker for CDK asset bundling.
- You need CDK bootstrap in the target account and region.
- Provider connectors need their own OAuth clients/secrets.
- App Runner is used by the current MCP service path; future versions may migrate to ECS Express Mode or ECS Fargate.

If you are evaluating Context101, start with one test brain and non-sensitive data. Treat the current release as a working alpha, not a hardened platform.
