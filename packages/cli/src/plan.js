import {
  CLAUDE_IMPROVE_MODEL,
  DEPLOY_WRAPPER,
  TITAN_EMBED_MODEL,
} from "./defaults.js";

export function deployCommand(seed) {
  return seed ? `${DEPLOY_WRAPPER} --seed` : DEPLOY_WRAPPER;
}

export function formatDryRun(plan) {
  const access = plan.requestBedrockAccess
    ? "request access for all (users pick later in the app)"
    : "skip requesting access";
  const embedDefault = plan.embedModelId
    ? `${plan.embedModelId} (--embed-model)`
    : `${TITAN_EMBED_MODEL} (CDK default)`;
  const models = plan.embeddingModels?.length
    ? `     ${plan.embeddingModels.map((m) => m.id).join(", ")}`
    : null;
  const lines = [
    "Plan (dry-run — nothing will be written, nothing will be deployed)",
    "",
    `  1. Local tools: Node 20+, npm, AWS CLI v2, Docker, optional gh`,
    plan.dockerInstalled && plan.dockerDaemon === false
      ? "     docker daemon is not running — start it before deploy"
      : null,
    `  2. AWS account in ${plan.region} (smooth path)`,
    plan.account
      ? `     account ${plan.account}`
      : "     aws sts get-caller-identity not confirmed",
    plan.awsProfile
      ? `     profile ${plan.awsProfile}`
      : plan.awsProfiles?.length > 1
        ? `     would ask which profile: ${plan.awsProfiles.join(", ")}`
        : plan.hasAwsKeys
          ? "     using AWS access keys (written to deploy-env)"
          : "     would ask for AWS access key and secret",
    `  3. CDK bootstrap: ${bootstrapLabel(plan)}`,
    `  4. Bedrock embeddings: ${access}`,
    models,
    `     default: ${embedDefault}`,
    `     Claude (${CLAUDE_IMPROVE_MODEL}) for Improve — wiki is paused; skip`,
    plan.repository
      ? `  5. Amplify: watch ${plan.repository}`
      : "  5. Amplify: skipped (stack only — no GitHub-watched web app)",
    plan.repository
      ? "     written as REPOSITORY in the env file (CDK reads it as context)"
      : "     a found-the-repo operator does not watch this checkout by default",
    plan.createRds
      ? "  6. Postgres: CDK creates RDS (db.t3.micro, public) — no DATABASE_URL in the env file"
      : `  6. Postgres: DATABASE_URL ${plan.hasDatabaseUrl ? "provided" : "missing"}, driver ${plan.databaseDriver}, prepare ${
          plan.databasePrepare ? "true" : "false"
        }`,
    `  7. Generate BETTER_AUTH_SECRET, MCP_TOKEN_PEPPER, CTX_TOKEN (not printed)`,
    `     APP_MODE=self_hosted  ALLOW_PUBLIC_SIGNUP=false  BILLING_ENABLED=false`,
    `     BETTER_AUTH_URL / APP_URL omitted — CDK uses the Amplify default domain`,
    "     or a domain you own. Never the hosted Context101 product.",
    `  8. Write ${plan.envDisplay} (chmod 600)`,
    plan.envExists
      ? "     file already exists — dry-run would refuse without --force"
      : "     file does not exist yet",
    `  9. Next command: ${deployCommand(plan.seed)}`,
    plan.repository
      ? "     never raw cdk deploy — the wrapper needs CTX_TOKEN + CTX_GH_TOKEN"
      : "     never raw cdk deploy — the wrapper needs CTX_TOKEN (Amplify PAT only if you watch a repo)",
    plan.repository
      ? " 10. After web is up: /setup on the Amplify domain (first admin)"
      : " 10. Amplify skipped — run web/ locally, or re-run with --repo to watch a GitHub repo",
    " 11. Optional connectors / wiki overlay: skipped",
    "",
    `Would write: ${plan.envDisplay}`,
    plan.deploy
      ? "Would run ./cdk/deploy.sh after writing (opt-in)."
      : "Would not deploy.",
  ];
  return lines.filter((line) => line !== null).join("\n");
}

function bootstrapLabel(plan) {
  if (plan.bootstrapped === true) return `already done in ${plan.region}`;
  if (plan.bootstrapped === false && plan.account) {
    return `needed — npx cdk bootstrap aws://${plan.account}/${plan.region}`;
  }
  return "not checked (no AWS identity)";
}

export function nextSteps(plan) {
  const rds = plan.createRds
    ? "CDK will create RDS Postgres and apply the control-plane schema. Fetch the secret via ControlPlaneDbSecretArn — the password is never printed."
    : null;
  if (plan.repository) {
    return [
      `Next: ${deployCommand(plan.seed)}`,
      rds,
      "After Amplify is up (~4 min), open /setup on WebAppDefaultDomain (or your own domain).",
      "Leave BETTER_AUTH_URL / APP_URL unset unless you bring your own host. CDK fills the Amplify default.",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `Next: ${deployCommand(plan.seed)}`,
    rds,
    "Amplify is skipped — this deploy is the AWS stack only (no GitHub-watched web app).",
    "Run the web app from web/, or re-run init with --repo when you want Amplify.",
    "Leave BETTER_AUTH_URL / APP_URL unset unless you bring your own host.",
  ]
    .filter(Boolean)
    .join("\n");
}
