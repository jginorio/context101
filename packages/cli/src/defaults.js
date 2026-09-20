export const SMOOTH_REGION = "us-east-1"; // pragma: allowlist secret
export const DEFAULT_AMPLIFY_REPO = "https://github.com/jginorio/context101";
export const TITAN_EMBED_MODEL = "amazon.titan-embed-text-v2:0";
export const CLAUDE_IMPROVE_MODEL = "us.anthropic.claude-opus-4-7";
export const DRIVER_NEON = "neon-http"; // pragma: allowlist secret
export const DRIVER_POSTGRES = "postgres-js";
export const APP_MODE = "self_hosted";
export const ALLOW_PUBLIC_SIGNUP = "false";
export const EXAMPLE_ENV_REL = "cdk/.deploy-env.example";
export const REPO_ENV_REL = "cdk/.deploy-env";
export const HOME_ENV_REL = ".context101/deploy-env";
export const HOME_SRC_REL = ".context101/src";
export const DEPLOY_CLI = "context101 deploy";
export const LIST_CLI = "context101 list";
export const DESTROY_CLI = "context101 destroy";
export const NPX_CLI = "npx context101-cli";
export const STACK_NAME = "Context101Stack";

export const SECRET_KEYS = [
  "CTX_TOKEN",
  "CTX_GH_TOKEN",
  "BETTER_AUTH_SECRET",
  "MCP_TOKEN_PEPPER",
  "DATABASE_URL",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
];
